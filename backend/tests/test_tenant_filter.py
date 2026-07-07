"""Regression test per il filtro tenant automatico a livello ORM.

Copre il listener `_tenant_filter_do_orm_execute` di backend.core.database, che
prima non era mai stato eseguito: referenziava `execute_state.is_column_stat`
(attributo inesistente in SQLAlchemy 2.0) e sarebbe andato in AttributeError su
ogni SELECT con contesto tenant impostato in-thread.

Il listener reale viene registrato su un sessionmaker in-memory isolato, così da
verificarne il comportamento senza toccare il DB di sviluppo.
"""
import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from backend.core.database import (
    Base,
    current_tenant_id,
    _tenant_filter_do_orm_execute,
)
from backend.db.modelli import Tenant, Asset


@pytest.fixture
def scoped_session():
    """Sessionmaker in-memory con il listener tenant reale agganciato."""
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    Session = sessionmaker(bind=engine)
    event.listen(Session, "do_orm_execute", _tenant_filter_do_orm_execute)
    Base.metadata.create_all(bind=engine)

    # Seed: due tenant con asset distinti (contextvar non impostato → nessun filtro)
    token = current_tenant_id.set(None)
    seed = Session()
    t1 = Tenant(nome="T1", slug="t1-filter")
    t2 = Tenant(nome="T2", slug="t2-filter")
    seed.add_all([t1, t2])
    seed.commit()
    seed.add_all(
        [
            Asset(nome="A1", area="P", tenant_id=t1.id),
            Asset(nome="A2", area="P", tenant_id=t2.id),
            Asset(nome="A3", area="P", tenant_id=t1.id),
        ]
    )
    seed.commit()
    ids = (t1.id, t2.id)
    seed.close()

    yield Session, ids

    current_tenant_id.reset(token)
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def test_no_context_returns_all_rows(scoped_session):
    """Senza contesto tenant il listener è un no-op: si vedono tutti gli asset."""
    Session, _ = scoped_session
    token = current_tenant_id.set(None)
    try:
        db = Session()
        names = sorted(a.nome for a in db.query(Asset).all())
        db.close()
    finally:
        current_tenant_id.reset(token)
    assert names == ["A1", "A2", "A3"]


def test_context_filters_by_tenant_without_crash(scoped_session):
    """Con contesto tenant impostato la SELECT è filtrata (regressione is_column_stat)."""
    Session, (id1, _id2) = scoped_session
    token = current_tenant_id.set(id1)
    try:
        db = Session()
        names = sorted(a.nome for a in db.query(Asset).all())
        db.close()
    finally:
        current_tenant_id.reset(token)
    assert names == ["A1", "A3"]


def test_sequential_tenants_no_cache_leak(scoped_session):
    """Valori tenant sequenziali non devono 'sanguinare' via cache dello statement."""
    Session, (id1, id2) = scoped_session
    db = Session()
    try:
        current_tenant_id.set(id1)
        r1 = sorted(a.nome for a in db.query(Asset).all())
        current_tenant_id.set(id2)
        r2 = sorted(a.nome for a in db.query(Asset).all())
        current_tenant_id.set(id1)
        r1_again = sorted(a.nome for a in db.query(Asset).all())
    finally:
        current_tenant_id.set(None)
        db.close()
    assert r1 == ["A1", "A3"]
    assert r2 == ["A2"]
    assert r1_again == ["A1", "A3"]


def test_model_without_tenant_id_is_not_filtered(scoped_session):
    """I modelli senza colonna tenant_id (es. Tenant) non devono sollevare errori."""
    Session, (id1, _id2) = scoped_session
    token = current_tenant_id.set(id1)
    try:
        db = Session()
        slugs = sorted(t.slug for t in db.query(Tenant).all())
        db.close()
    finally:
        current_tenant_id.reset(token)
    assert slugs == ["t1-filter", "t2-filter"]
