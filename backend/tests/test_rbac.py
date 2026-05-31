"""
Test RBAC — verifica che require_roles() blocchi i tecnici sugli endpoint di gestione
e ammetta i responsabili (e sempre i superadmin).

Eseguibili con: JWT_SECRET=... ENCRYPTION_KEY=... python -m pytest backend/tests/test_rbac.py -v
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.database import Base
from backend.core.dependencies import get_db
from backend.core.security import get_current_user_payload, get_current_tenant_id
from backend.main import app


# ── Helper payloads ───────────────────────────────────────────────────────────

def _payload_tecnico(tenant_id: int = 1) -> dict:
    return {"sub": "tecnico_test", "ruolo": "tecnico", "tenant_id": tenant_id}


def _payload_responsabile(tenant_id: int = 1) -> dict:
    return {"sub": "responsabile_test", "ruolo": "responsabile", "tenant_id": tenant_id}


def _payload_superadmin() -> dict:
    return {"sub": "superadmin_test", "ruolo": "superadmin", "tenant_id": None}


# ── Fixtures ──────────────────────────────────────────────────────────────────

TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="module")
def db_engine_rbac():
    engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session_rbac(db_engine_rbac):
    connection = db_engine_rbac.connect()
    transaction = connection.begin()
    Session = sessionmaker(bind=connection)
    session = Session()
    yield session
    session.close()
    transaction.rollback()
    connection.close()


def _make_client(db_session, payload: dict, tenant_id: int | None = 1) -> TestClient:
    """Costruisce un TestClient con auth simulata per il ruolo dato."""
    from backend.core.rate_limiter import limiter as _rate_limiter
    _rate_limiter.enabled = False

    def override_get_db():
        yield db_session

    def override_payload():
        return payload

    def override_tenant():
        return tenant_id

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_payload] = override_payload
    app.dependency_overrides[get_current_tenant_id] = override_tenant

    return TestClient(app, base_url="https://testserver", headers={"origin": "http://localhost:3000"})


# ── RBAC-01: tecnico → 403 su creazione asset ─────────────────────────────────

def test_rbac01_tecnico_cannot_create_asset(db_session_rbac):
    """Un tecnico NON deve poter creare un asset (403 Forbidden)."""
    client = _make_client(db_session_rbac, _payload_tecnico())
    try:
        resp = client.post("/assets", json={
            "nome": "Compressore Test",
            "area": "Zona A",
            "tipo": "Meccanico",
        })
        assert resp.status_code == 403, f"Atteso 403, ottenuto {resp.status_code}: {resp.text}"
    finally:
        app.dependency_overrides.clear()


# ── RBAC-02: responsabile → 201 su creazione asset ───────────────────────────

def test_rbac02_responsabile_can_create_asset(db_session_rbac):
    """Un responsabile DEVE poter creare un asset (201 Created)."""
    client = _make_client(db_session_rbac, _payload_responsabile())
    try:
        resp = client.post("/assets", json={
            "nome": "Compressore Resp",
            "area": "Zona B",
            "tipo": "Meccanico",
        })
        assert resp.status_code == 201, f"Atteso 201, ottenuto {resp.status_code}: {resp.text}"
    finally:
        app.dependency_overrides.clear()


# ── RBAC-03: tecnico → 403 su creazione sito ─────────────────────────────────

def test_rbac03_tecnico_cannot_create_sito(db_session_rbac):
    """Un tecnico NON deve poter creare un sito (403 Forbidden)."""
    client = _make_client(db_session_rbac, _payload_tecnico())
    try:
        resp = client.post("/siti", json={"nome": "Stabilimento Test"})
        assert resp.status_code == 403, f"Atteso 403, ottenuto {resp.status_code}: {resp.text}"
    finally:
        app.dependency_overrides.clear()


# ── RBAC-04: responsabile → 201 su creazione sito ────────────────────────────

def test_rbac04_responsabile_can_create_sito(db_session_rbac):
    """Un responsabile DEVE poter creare un sito (201 Created)."""
    client = _make_client(db_session_rbac, _payload_responsabile())
    try:
        resp = client.post("/siti", json={"nome": "Stabilimento Resp"})
        assert resp.status_code == 201, f"Atteso 201, ottenuto {resp.status_code}: {resp.text}"
    finally:
        app.dependency_overrides.clear()


# ── RBAC-05: tecnico → 403 su creazione tecnico ──────────────────────────────

def test_rbac05_tecnico_cannot_create_tecnico(db_session_rbac):
    """Un tecnico NON deve poter creare un profilo tecnico (403 Forbidden)."""
    client = _make_client(db_session_rbac, _payload_tecnico())
    try:
        resp = client.post("/tecnici", json={
            "nome": "Mario",
            "cognome": "Rossi",
            "specializzazione": "Meccanico",
        })
        assert resp.status_code == 403, f"Atteso 403, ottenuto {resp.status_code}: {resp.text}"
    finally:
        app.dependency_overrides.clear()


# ── RBAC-06: responsabile → 201 su creazione tecnico ─────────────────────────

def test_rbac06_responsabile_can_create_tecnico(db_session_rbac):
    """Un responsabile DEVE poter creare un profilo tecnico (201 Created)."""
    client = _make_client(db_session_rbac, _payload_responsabile())
    try:
        resp = client.post("/tecnici", json={
            "nome": "Luigi",
            "cognome": "Bianchi",
            "specializzazione": "Elettricista",
        })
        assert resp.status_code == 201, f"Atteso 201, ottenuto {resp.status_code}: {resp.text}"
    finally:
        app.dependency_overrides.clear()


# ── RBAC-07: tecnico → 403 su confirm piano ──────────────────────────────────

def test_rbac07_tecnico_cannot_confirm_plan(db_session_rbac):
    """Un tecnico NON deve poter confermare un piano (403 Forbidden)."""
    client = _make_client(db_session_rbac, _payload_tecnico())
    try:
        resp = client.post("/planning/confirm/9999")
        assert resp.status_code == 403, f"Atteso 403, ottenuto {resp.status_code}: {resp.text}"
    finally:
        app.dependency_overrides.clear()


# ── RBAC-08: responsabile → 404 su confirm piano inesistente ─────────────────

def test_rbac08_responsabile_reaches_confirm_plan(db_session_rbac):
    """
    Un responsabile supera il controllo RBAC e arriva alla logica di business.
    Piano 9999 non esiste → 404 (non 403).
    """
    client = _make_client(db_session_rbac, _payload_responsabile())
    try:
        resp = client.post("/planning/confirm/9999")
        assert resp.status_code == 404, f"Atteso 404 (piano inesistente), ottenuto {resp.status_code}: {resp.text}"
    finally:
        app.dependency_overrides.clear()


# ── RBAC-09: superadmin → bypassa il check ruolo ─────────────────────────────

def test_rbac09_superadmin_bypasses_rbac(db_session_rbac):
    """Un superadmin deve sempre superare il check RBAC (anche senza ruolo in allowed)."""
    client = _make_client(db_session_rbac, _payload_superadmin(), tenant_id=None)
    try:
        # confirm/9999 → supera RBAC → 404 da business logic (piano non trovato)
        resp = client.post("/planning/confirm/9999")
        assert resp.status_code != 403, f"Superadmin non deve ricevere 403, ottenuto {resp.status_code}"
    finally:
        app.dependency_overrides.clear()


# ── RBAC-10: tecnico → 403 su deauthorize piano ──────────────────────────────

def test_rbac10_tecnico_cannot_deauthorize_plan(db_session_rbac):
    """Un tecnico NON deve poter deautorizzare un piano (403 Forbidden)."""
    client = _make_client(db_session_rbac, _payload_tecnico())
    try:
        resp = client.post("/planning/deauthorize/9999", json={"reason": "test"})
        assert resp.status_code == 403, f"Atteso 403, ottenuto {resp.status_code}: {resp.text}"
    finally:
        app.dependency_overrides.clear()
