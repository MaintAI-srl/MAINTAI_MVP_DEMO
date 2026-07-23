"""Test del magazzino ricambi: disponibilità, prenotazione e gate di pianificazione."""
import os

os.environ.setdefault("JWT_SECRET", "test-secret-" + "0" * 32)
os.environ.setdefault(
    "ENCRYPTION_KEY", "hnKp3sVw8kZ2mQ9xL5rT7bD0fG4jN6yA1cE8uW2iO3s=",
)

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.database import Base
from backend.db.modelli import (
    MovimentoRicambio, Ricambio, Tenant, Ticket, TicketRicambio,
)
from backend.services import ricambi_service


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    tenant = Tenant(id=1, nome="Acme", slug="acme")
    session.add(tenant)
    session.commit()
    yield session
    session.close()


def _ricambio(db, codice="RIC-1", giacenza=10.0):
    r = Ricambio(tenant_id=1, codice=codice, descrizione=f"Pezzo {codice}", giacenza=giacenza)
    db.add(r)
    db.commit()
    db.refresh(r)
    return r


def _ticket(db, stato="Aperto", tipo="CM"):
    t = Ticket(tenant_id=1, titolo="T", stato=stato, tipo=tipo, priorita="Media", durata_stimata_ore=2)
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


def _need(db, ticket, ricambio=None, qty=1.0, descr=None, is_nuovo=False):
    tr = TicketRicambio(
        tenant_id=1, ticket_id=ticket.id,
        ricambio_id=ricambio.id if ricambio else None,
        descrizione=descr, quantita=qty, is_nuovo=is_nuovo,
    )
    db.add(tr)
    db.commit()
    return tr


def test_availability_no_reservations(db):
    r = _ricambio(db, giacenza=5)
    avail = ricambi_service.availability_map(db, 1)
    assert avail[r.id]["disponibile"] == 5
    assert avail[r.id]["prenotato"] == 0


def test_reservation_reduces_availability(db):
    r = _ricambio(db, giacenza=5)
    t = _ticket(db, stato="Pianificato")
    _need(db, t, r, qty=3)
    avail = ricambi_service.availability_map(db, 1)
    assert avail[r.id]["prenotato"] == 3
    assert avail[r.id]["disponibile"] == 2


def test_open_ticket_does_not_reserve(db):
    r = _ricambio(db, giacenza=5)
    t = _ticket(db, stato="Aperto")
    _need(db, t, r, qty=3)
    # Un ticket Aperto non impegna ancora lo stock
    avail = ricambi_service.availability_map(db, 1)
    assert avail[r.id]["prenotato"] == 0


def test_gate_allows_ticket_with_stock(db):
    r = _ricambio(db, giacenza=5)
    t = _ticket(db)
    _need(db, t, r, qty=2)
    schedulable, blocked = ricambi_service.partition_by_spare_parts(db, 1, [t])
    assert [x.id for x in schedulable] == [t.id]
    assert blocked == []


def test_gate_blocks_new_spare_part(db):
    t = _ticket(db)
    _need(db, t, ricambio=None, qty=1, descr="Sensore nuovo", is_nuovo=True)
    schedulable, blocked = ricambi_service.partition_by_spare_parts(db, 1, [t])
    assert schedulable == []
    assert len(blocked) == 1
    assert blocked[0]["reason_code"] == "SPARE_PART_MISSING"


def test_gate_blocks_insufficient_stock(db):
    r = _ricambio(db, giacenza=1)
    t = _ticket(db)
    _need(db, t, r, qty=5)
    schedulable, blocked = ricambi_service.partition_by_spare_parts(db, 1, [t])
    assert schedulable == []
    assert len(blocked) == 1


def test_gate_competition_priority(db):
    # Stock per un solo ticket: il BD (priorità più alta) vince, il PM è bloccato
    r = _ricambio(db, giacenza=1)
    t_pm = _ticket(db, tipo="PM")
    t_bd = _ticket(db, tipo="BD")
    _need(db, t_pm, r, qty=1)
    _need(db, t_bd, r, qty=1)
    schedulable, blocked = ricambi_service.partition_by_spare_parts(db, 1, [t_pm, t_bd])
    assert [x.id for x in schedulable] == [t_bd.id]
    assert [b["wo_id"] for b in blocked] == [t_pm.id]


def test_gate_noop_without_spare_parts(db):
    # Ticket senza ricambi: mai bloccato (nessuna regressione sul flusso legacy)
    t = _ticket(db)
    schedulable, blocked = ricambi_service.partition_by_spare_parts(db, 1, [t])
    assert [x.id for x in schedulable] == [t.id]
    assert blocked == []


def test_movimento_carico_scarico(db):
    r = _ricambio(db, giacenza=5)
    ricambi_service.register_movimento(db, 1, r, "carico", 3, causale="rifornimento")
    assert r.giacenza == 8
    ricambi_service.register_movimento(db, 1, r, "scarico", 10, causale="uso")
    assert r.giacenza == 0  # non scende sotto zero
    ricambi_service.register_movimento(db, 1, r, "rettifica", 4, causale="inventario")
    assert r.giacenza == 4
    movimenti = db.query(MovimentoRicambio).filter_by(ricambio_id=r.id).count()
    assert movimenti == 3


def test_ticket_status_summary_blocking(db):
    r = _ricambio(db, giacenza=1)
    t = _ticket(db)
    _need(db, t, r, qty=5)          # insufficiente
    _need(db, t, None, qty=1, descr="nuovo", is_nuovo=True)  # nuovo
    summary = ricambi_service.ticket_ricambi_status(db, 1, t.id)
    assert summary["bloccante"] is True
    assert len(summary["righe"]) == 2
    assert len(summary["mancanti"]) == 2
