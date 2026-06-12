"""
Test RBAC sulle route ticket (matrice ruoli, audit v1.2).

Matrice:
- tecnico:      aggiorna l'esecuzione (In corso / Chiuso / pausa), crea ticket da campo.
                NON può: bulk update, eliminare, pianificare/assegnare, sync gerarchia.
- responsabile: tutte le operazioni di gestione.
- superadmin:   override.

Eseguibili con: JWT_SECRET=... ENCRYPTION_KEY=... python -m pytest backend/tests/test_rbac_tickets.py -v
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.database import Base
from backend.core.dependencies import get_db
from backend.core.security import get_current_user_payload, get_current_tenant_id
from backend.db.modelli import Tenant, Ticket
from backend.main import app

TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="module")
def db_engine_tk():
    engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session_tk(db_engine_tk):
    connection = db_engine_tk.connect()
    transaction = connection.begin()
    Session = sessionmaker(bind=connection)
    session = Session()
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def ticket(db_session_tk):
    tenant = Tenant(nome="Acme", slug="acme-rbac-tk")
    db_session_tk.add(tenant)
    db_session_tk.flush()
    t = Ticket(
        titolo="Pompa rumorosa",
        tipo="BD",
        priorita="Media",
        stato="Aperto",
        durata_stimata_ore=2.0,
        tenant_id=tenant.id,
    )
    db_session_tk.add(t)
    db_session_tk.commit()
    return t


def _client(db_session, ruolo: str, tenant_id: int) -> TestClient:
    from backend.core.rate_limiter import limiter as _rate_limiter
    _rate_limiter.enabled = False

    payload = {"sub": f"{ruolo}_test", "ruolo": ruolo, "tenant_id": tenant_id}

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_payload] = lambda: payload
    app.dependency_overrides[get_current_tenant_id] = lambda: tenant_id
    return TestClient(app, base_url="https://testserver", headers={"origin": "http://localhost:3000"})


@pytest.fixture(autouse=True)
def _cleanup_overrides():
    yield
    app.dependency_overrides.clear()


# ── Bulk update: solo responsabile ────────────────────────────────────────────

def test_tecnico_cannot_bulk_update(db_session_tk, ticket):
    client = _client(db_session_tk, "tecnico", ticket.tenant_id)
    resp = client.patch("/tickets/bulk-status", json={"ids": [ticket.id], "stato": "Chiuso"})
    assert resp.status_code == 403, resp.text


def test_responsabile_can_bulk_update(db_session_tk, ticket):
    client = _client(db_session_tk, "responsabile", ticket.tenant_id)
    resp = client.patch("/tickets/bulk-status", json={"ids": [ticket.id], "stato": "Chiuso"})
    assert resp.status_code == 200, resp.text


# ── Eliminazione: solo responsabile ───────────────────────────────────────────

def test_tecnico_cannot_delete_ticket(db_session_tk, ticket):
    client = _client(db_session_tk, "tecnico", ticket.tenant_id)
    resp = client.patch(f"/tickets/{ticket.id}", json={
        "stato": "Eliminato", "eliminazione_note": "tentativo non autorizzato",
    })
    assert resp.status_code == 403, resp.text


def test_responsabile_can_delete_ticket(db_session_tk, ticket):
    client = _client(db_session_tk, "responsabile", ticket.tenant_id)
    resp = client.patch(f"/tickets/{ticket.id}", json={
        "stato": "Eliminato", "eliminazione_note": "asset dismesso",
    })
    assert resp.status_code == 200, resp.text


# ── Pianificazione/assegnazione: solo responsabile ────────────────────────────

@pytest.mark.parametrize("body", [
    {"tecnico_id": 1},
    {"planned_start": "2026-06-15T08:00:00"},
    {"planned_finish": "2026-06-15T10:00:00"},
    {"is_manual_plan": True},
])
def test_tecnico_cannot_set_planning_fields(db_session_tk, ticket, body):
    client = _client(db_session_tk, "tecnico", ticket.tenant_id)
    resp = client.patch(f"/tickets/{ticket.id}", json=body)
    assert resp.status_code == 403, f"{body}: atteso 403, ottenuto {resp.status_code}: {resp.text}"


def test_tecnico_cannot_set_planning_fields_via_put(db_session_tk, ticket):
    client = _client(db_session_tk, "tecnico", ticket.tenant_id)
    resp = client.put(f"/tickets/{ticket.id}", json={"tecnico_id": 1})
    assert resp.status_code == 403, resp.text


# ── Esecuzione: il tecnico PUÒ aggiornare ─────────────────────────────────────

def test_tecnico_can_update_execution(db_session_tk, ticket):
    client = _client(db_session_tk, "tecnico", ticket.tenant_id)
    resp = client.put(f"/tickets/{ticket.id}", json={
        "stato": "In corso", "execution_start": "2026-06-15T08:00:00",
    })
    assert resp.status_code == 200, resp.text


def test_tecnico_can_close_ticket(db_session_tk, ticket):
    client = _client(db_session_tk, "tecnico", ticket.tenant_id)
    resp = client.put(f"/tickets/{ticket.id}", json={
        "stato": "Chiuso", "execution_finish": "2026-06-15T10:00:00",
    })
    assert resp.status_code == 200, resp.text


# ── Sync gerarchia: solo responsabile ─────────────────────────────────────────

def test_tecnico_cannot_sync_hierarchy(db_session_tk, ticket):
    client = _client(db_session_tk, "tecnico", ticket.tenant_id)
    resp = client.post("/sync-tickets-hierarchy")
    assert resp.status_code == 403, resp.text


def test_responsabile_can_sync_hierarchy(db_session_tk, ticket):
    client = _client(db_session_tk, "responsabile", ticket.tenant_id)
    resp = client.post("/sync-tickets-hierarchy")
    assert resp.status_code == 200, resp.text


# ── Superadmin override ───────────────────────────────────────────────────────

def test_superadmin_can_bulk_update(db_session_tk, ticket):
    client = _client(db_session_tk, "superadmin", ticket.tenant_id)
    resp = client.patch("/tickets/bulk-status", json={"ids": [ticket.id], "stato": "Chiuso"})
    assert resp.status_code == 200, resp.text
