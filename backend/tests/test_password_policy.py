"""
Test della password policy centralizzata (SEC-009).

La policy (min 12 caratteri, maiuscole+minuscole+numeri+simboli) vive SOLO in
backend/core/security.py e deve essere applicata da TUTTI i percorsi che
impostano una password:
- POST /auth/change-password   (cambio password utente)
- POST /utenti                 (creazione utente tenant)
- PUT  /utenti/{id}/password   (reset password utente)
- POST /tenants                (creazione tenant con admin)
- POST /tenants/{id}/utenti    (creazione utente da superadmin)
- PUT  /tenants/{id}/utenti/{uid}/password (reset da superadmin)

Eseguibili con: JWT_SECRET=... ENCRYPTION_KEY=... python -m pytest backend/tests/test_password_policy.py -v
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.database import Base
from backend.core.dependencies import get_db
from backend.core.security import (
    get_current_user_payload, get_current_tenant_id, get_password_hash,
)
from backend.db.modelli import Tenant, Utente
from backend.main import app

# 8 caratteri, rispetta la complessità ma NON il minimo di 12: deve essere rifiutata ovunque.
WEAK_8 = "Aa1!aaaa"
# 11 caratteri: ancora sotto il minimo.
WEAK_11 = "Aa1!aaaaaaa"
# 12+ caratteri con complessità completa: deve essere accettata ovunque.
STRONG_12 = "Aa1!aaaaaaaa"

CURRENT_PASSWORD = "Attuale1!Sicura"

TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="module")
def db_engine_pwd():
    engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session_pwd(db_engine_pwd):
    connection = db_engine_pwd.connect()
    transaction = connection.begin()
    Session = sessionmaker(bind=connection)
    session = Session()
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def seeded(db_session_pwd):
    """Tenant + utente responsabile con password nota."""
    tenant = Tenant(nome="Acme", slug="acme-pwd")
    db_session_pwd.add(tenant)
    db_session_pwd.flush()
    user = Utente(
        username="resp_pwd_test",
        password_hash=get_password_hash(CURRENT_PASSWORD),
        ruolo="responsabile",
        tenant_id=tenant.id,
    )
    db_session_pwd.add(user)
    db_session_pwd.commit()
    return tenant, user


def _make_client(db_session, payload: dict, tenant_id: int | None) -> TestClient:
    from backend.core.rate_limiter import limiter as _rate_limiter
    _rate_limiter.enabled = False

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_payload] = lambda: payload
    app.dependency_overrides[get_current_tenant_id] = lambda: tenant_id
    return TestClient(app, base_url="https://testserver", headers={"origin": "http://localhost:3000"})


@pytest.fixture
def client_resp(db_session_pwd, seeded):
    tenant, user = seeded
    payload = {"sub": user.username, "ruolo": "responsabile", "tenant_id": tenant.id}
    yield _make_client(db_session_pwd, payload, tenant.id), tenant, user
    app.dependency_overrides.clear()


@pytest.fixture
def client_superadmin(db_session_pwd, seeded):
    tenant, user = seeded
    payload = {"sub": "superadmin_test", "ruolo": "superadmin", "tenant_id": None}
    yield _make_client(db_session_pwd, payload, tenant.id), tenant, user
    app.dependency_overrides.clear()


# ── /auth/change-password ─────────────────────────────────────────────────────

@pytest.mark.parametrize("weak", [WEAK_8, WEAK_11])
def test_change_password_rejects_short(client_resp, weak):
    client, _, _ = client_resp
    resp = client.post("/auth/change-password", json={
        "current_password": CURRENT_PASSWORD, "new_password": weak,
    })
    assert resp.status_code == 422, f"{weak!r}: atteso 422, ottenuto {resp.status_code}: {resp.text}"


def test_change_password_accepts_strong(client_resp):
    client, _, _ = client_resp
    resp = client.post("/auth/change-password", json={
        "current_password": CURRENT_PASSWORD, "new_password": STRONG_12,
    })
    assert resp.status_code == 200, resp.text


# ── /utenti (creazione + reset) ───────────────────────────────────────────────

@pytest.mark.parametrize("weak", [WEAK_8, WEAK_11])
def test_create_utente_rejects_short(client_resp, weak):
    client, _, _ = client_resp
    resp = client.post("/utenti", json={"username": "nuovo_utente", "password": weak, "ruolo": "tecnico"})
    assert resp.status_code == 422, f"{weak!r}: atteso 422, ottenuto {resp.status_code}: {resp.text}"


def test_create_utente_accepts_strong(client_resp):
    client, _, _ = client_resp
    resp = client.post("/utenti", json={"username": "nuovo_utente_ok", "password": STRONG_12, "ruolo": "tecnico"})
    assert resp.status_code == 201, resp.text


@pytest.mark.parametrize("weak", [WEAK_8, WEAK_11])
def test_reset_password_utente_rejects_short(client_resp, weak):
    client, _, user = client_resp
    resp = client.put(f"/utenti/{user.id}/password", json={"new_password": weak})
    assert resp.status_code == 422, f"{weak!r}: atteso 422, ottenuto {resp.status_code}: {resp.text}"


def test_reset_password_utente_accepts_strong(client_resp):
    client, _, user = client_resp
    resp = client.put(f"/utenti/{user.id}/password", json={"new_password": STRONG_12})
    assert resp.status_code == 200, resp.text


# ── /tenants (superadmin) ─────────────────────────────────────────────────────

@pytest.mark.parametrize("weak", [WEAK_8, WEAK_11])
def test_create_tenant_rejects_short_admin_password(client_superadmin, weak):
    client, _, _ = client_superadmin
    resp = client.post("/tenants", json={
        "nome": "Nuovo Cliente", "slug": "nuovo-cliente",
        "admin_username": "admin_nuovo", "admin_password": weak,
    })
    assert resp.status_code == 422, f"{weak!r}: atteso 422, ottenuto {resp.status_code}: {resp.text}"


def test_create_tenant_accepts_strong_admin_password(client_superadmin):
    client, _, _ = client_superadmin
    resp = client.post("/tenants", json={
        "nome": "Nuovo Cliente OK", "slug": "nuovo-cliente-ok",
        "admin_username": "admin_nuovo_ok", "admin_password": STRONG_12,
    })
    assert resp.status_code == 201, resp.text


@pytest.mark.parametrize("weak", [WEAK_8, WEAK_11])
def test_add_utente_tenant_rejects_short(client_superadmin, weak):
    client, tenant, _ = client_superadmin
    resp = client.post(f"/tenants/{tenant.id}/utenti", json={
        "username": "utente_tenant", "password": weak, "ruolo": "tecnico",
    })
    assert resp.status_code == 422, f"{weak!r}: atteso 422, ottenuto {resp.status_code}: {resp.text}"


def test_add_utente_tenant_accepts_strong(client_superadmin):
    client, tenant, _ = client_superadmin
    resp = client.post(f"/tenants/{tenant.id}/utenti", json={
        "username": "utente_tenant_ok", "password": STRONG_12, "ruolo": "tecnico",
    })
    assert resp.status_code == 201, resp.text


@pytest.mark.parametrize("weak", [WEAK_8, WEAK_11])
def test_superadmin_reset_rejects_short(client_superadmin, weak):
    client, tenant, user = client_superadmin
    resp = client.put(f"/tenants/{tenant.id}/utenti/{user.id}/password", json={"new_password": weak})
    assert resp.status_code == 422, f"{weak!r}: atteso 422, ottenuto {resp.status_code}: {resp.text}"


def test_superadmin_reset_accepts_strong(client_superadmin):
    client, tenant, user = client_superadmin
    resp = client.put(f"/tenants/{tenant.id}/utenti/{user.id}/password", json={"new_password": STRONG_12})
    assert resp.status_code == 200, resp.text
