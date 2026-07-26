"""
Test moduli per-tenant + validazione X-Tenant-Id.

- PUT /admin/modules con X-Tenant-Id salva l'override del singolo tenant
- GET /modules riflette la configurazione effettiva del contesto
- Il gate dei router (404 "Funzionalita disattivata per questo cliente")
  vale solo per il tenant con l'override, non per gli altri
- Il superadmin non resta mai chiuso fuori da /tenants
- get_current_tenant_id valida l'header X-Tenant-Id (400/404 espliciti)

Eseguibili con: JWT_SECRET=... ENCRYPTION_KEY=... python -m pytest backend/tests/test_tenant_modules.py -v
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.database import Base
from backend.core.dependencies import get_db
from backend.core.modules import (
    MODULE_DEFINITIONS,
    _tenant_override_cache,
    is_module_enabled,
    is_module_enabled_for_tenant,
)
from backend.core.security import (
    COOKIE_NAME,
    create_access_token,
    get_current_user_payload,
)
from backend.db.modelli import Tenant
from backend.main import app


TEST_DATABASE_URL = "sqlite:///:memory:"


@pytest.fixture(scope="module")
def db_engine_tm():
    engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session_tm(db_engine_tm):
    connection = db_engine_tm.connect()
    transaction = connection.begin()
    Session = sessionmaker(bind=connection)
    session = Session()
    _tenant_override_cache.clear()
    yield session
    session.close()
    transaction.rollback()
    connection.close()
    _tenant_override_cache.clear()


def _seed_tenants(db) -> tuple[int, int]:
    t1 = Tenant(nome="Alfa", slug="alfa-tm", is_active=True)
    t2 = Tenant(nome="Beta", slug="beta-tm", is_active=True)
    db.add_all([t1, t2])
    db.commit()
    return t1.id, t2.id


def _make_client(db_session, payload: dict) -> TestClient:
    """TestClient con get_db override e cookie JWT reale.

    Il payload di auth è iniettato via dependency override, ma il cookie JWT
    è reale: serve al gate dei moduli che decodifica il token in modo leniente
    direttamente dalla richiesta.
    """
    from backend.core.rate_limiter import limiter as _rate_limiter
    _rate_limiter.enabled = False

    def override_get_db():
        yield db_session

    def override_payload():
        return payload

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_payload] = override_payload

    client = TestClient(app, base_url="https://testserver", headers={"origin": "http://localhost:3000"})
    client.cookies.set(COOKIE_NAME, create_access_token(payload))
    return client


def _superadmin_payload() -> dict:
    return {"sub": "sa_tm", "ruolo": "superadmin", "tenant_id": None}


def _user_payload(tenant_id: int) -> dict:
    return {"sub": f"user_t{tenant_id}", "ruolo": "responsabile", "tenant_id": tenant_id}


# ── Override per-tenant via API ───────────────────────────────────────────────

def test_put_tenant_override_and_get_modules(db_session_tm):
    t1, _t2 = _seed_tenants(db_session_tm)
    client = _make_client(db_session_tm, _superadmin_payload())
    try:
        # Disattiva "technicians" (e dipendenti) solo per il tenant t1
        enabled = ["dashboard", "assets", "tickets"]
        resp = client.put("/admin/modules", json={"enabled": enabled}, headers={"X-Tenant-Id": str(t1)})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["has_override"] is True
        assert body["scope"] == "tenant"
        assert "technicians" not in body["enabled"]
        assert "tickets" in body["enabled"]

        # GET /modules con contesto t1 → override; senza header → globale
        resp_t1 = client.get("/modules", headers={"X-Tenant-Id": str(t1)})
        assert resp_t1.status_code == 200
        assert "technicians" not in resp_t1.json()["enabled"]

        resp_global = client.get("/modules")
        assert resp_global.status_code == 200
        assert "technicians" in resp_global.json()["enabled"]
    finally:
        app.dependency_overrides.clear()


def test_gate_blocks_only_override_tenant(db_session_tm):
    t1, t2 = _seed_tenants(db_session_tm)
    sa = _make_client(db_session_tm, _superadmin_payload())
    try:
        resp = sa.put("/admin/modules", json={"enabled": ["dashboard", "assets", "tickets"]}, headers={"X-Tenant-Id": str(t1)})
        assert resp.status_code == 200, resp.text
    finally:
        app.dependency_overrides.clear()

    # Utente del tenant t1 → 404 sul modulo disattivato
    c1 = _make_client(db_session_tm, _user_payload(t1))
    try:
        resp = c1.get("/tecnici")
        assert resp.status_code == 404, f"Atteso 404 per tenant con override, ottenuto {resp.status_code}"
        assert "disattivata" in resp.json().get("detail", "")
    finally:
        app.dependency_overrides.clear()

    # Utente del tenant t2 → il modulo resta attivo
    c2 = _make_client(db_session_tm, _user_payload(t2))
    try:
        resp = c2.get("/tecnici")
        assert resp.status_code == 200, f"Atteso 200 per tenant senza override, ottenuto {resp.status_code}: {resp.text}"
    finally:
        app.dependency_overrides.clear()


def test_superadmin_never_locked_out_of_tenants(db_session_tm):
    t1, _ = _seed_tenants(db_session_tm)
    sa = _make_client(db_session_tm, _superadmin_payload())
    try:
        # Anche disattivando TUTTO per t1, /tenants resta accessibile al superadmin
        resp = sa.put("/admin/modules", json={"enabled": []}, headers={"X-Tenant-Id": str(t1)})
        assert resp.status_code == 200, resp.text
        resp = sa.get("/tenants", headers={"X-Tenant-Id": str(t1)})
        assert resp.status_code == 200, f"Superadmin bloccato fuori da /tenants: {resp.status_code}"
    finally:
        app.dependency_overrides.clear()


def test_delete_override_restores_global(db_session_tm):
    t1, _ = _seed_tenants(db_session_tm)
    sa = _make_client(db_session_tm, _superadmin_payload())
    try:
        sa.put("/admin/modules", json={"enabled": ["dashboard", "assets", "tickets"]}, headers={"X-Tenant-Id": str(t1)})
        resp = sa.delete("/admin/modules/override", headers={"X-Tenant-Id": str(t1)})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["has_override"] is False
        assert "technicians" in body["enabled"]

        # Senza header → 400 esplicito
        resp = sa.delete("/admin/modules/override")
        assert resp.status_code == 400
    finally:
        app.dependency_overrides.clear()


# ── Moduli nuovi vs configurazione già salvata ────────────────────────────────
# Regressione 2026-07-26: la config salvata era una whitelist, quindi ogni modulo
# introdotto dopo un salvataggio restava spento per sempre e nessun default di
# codice poteva riaccenderlo (sintomo: /xr invisibile e interruttore del cliente
# che "torna indietro" dopo il salvataggio).

def test_module_added_after_save_follows_global_config(db_session_tm):
    """Un modulo assente dall'override perche non esisteva ancora segue il globale."""
    import json as _json
    from backend.db.modelli import TenantModuleConfig

    t1, _ = _seed_tenants(db_session_tm)

    # Override salvato quando xr_viewer non esisteva: e' fra i `known` di allora.
    known_allora = sorted(set(MODULE_DEFINITIONS) - {"xr_viewer"})
    db_session_tm.add(
        TenantModuleConfig(
            tenant_id=t1,
            enabled=_json.dumps({"enabled": known_allora, "known": known_allora}),
        )
    )
    db_session_tm.commit()
    _tenant_override_cache.clear()

    assert is_module_enabled("xr_viewer"), "xr_viewer deve essere attivo di default in globale"
    assert is_module_enabled_for_tenant(db_session_tm, "xr_viewer", t1), (
        "un modulo introdotto dopo il salvataggio dell'override deve seguire il globale, "
        "non restare spento in modo invisibile"
    )


def test_explicit_off_survives_new_module_handling(db_session_tm):
    """Uno spegnimento esplicito resta spento (non viene riacceso dal default)."""
    t1, _ = _seed_tenants(db_session_tm)
    sa = _make_client(db_session_tm, _superadmin_payload())
    try:
        tutti_tranne_xr = sorted(set(MODULE_DEFINITIONS) - {"xr_viewer"})
        resp = sa.put("/admin/modules", json={"enabled": tutti_tranne_xr}, headers={"X-Tenant-Id": str(t1)})
        assert resp.status_code == 200, resp.text
        assert "xr_viewer" not in resp.json()["enabled"]
    finally:
        app.dependency_overrides.clear()

    _tenant_override_cache.clear()
    assert not is_module_enabled_for_tenant(db_session_tm, "xr_viewer", t1), (
        "uno spegnimento esplicito deve persistere"
    )


def test_legacy_whitelist_format_is_still_read(db_session_tm):
    """Le righe nel vecchio formato (lista nuda) restano leggibili."""
    import json as _json
    from backend.db.modelli import TenantModuleConfig

    t1, _ = _seed_tenants(db_session_tm)
    db_session_tm.add(
        TenantModuleConfig(tenant_id=t1, enabled=_json.dumps(["dashboard", "assets", "tickets"]))
    )
    db_session_tm.commit()
    _tenant_override_cache.clear()

    from backend.core.modules import get_tenant_decisions

    decisions = get_tenant_decisions(db_session_tm, t1)
    assert decisions is not None, "l'override legacy deve essere riconosciuto"
    assert "tickets" in decisions.on
    # Nessun `known` registrato → nessuno spegnimento esplicito deducibile
    assert decisions.off == frozenset()


def test_payload_flags_modules_blocked_by_global(db_session_tm):
    """Il payload dichiara i moduli non attivabili per cliente (kill-switch globale)."""
    from backend.core.modules import modules_payload_for

    t1, _ = _seed_tenants(db_session_tm)
    payload = modules_payload_for(db_session_tm, t1)

    assert "blocked_by_global" in payload
    assert "global_enabled" in payload
    # guide_ai e' default_enabled=False → spento globalmente → non attivabile
    assert "guide_ai" in payload["blocked_by_global"]
    guide = next(m for m in payload["modules"] if m["id"] == "guide_ai")
    assert guide["blocked_by_global"] is True
    dashboard = next(m for m in payload["modules"] if m["id"] == "dashboard")
    assert dashboard["blocked_by_global"] is False


# ── Validazione X-Tenant-Id in get_current_tenant_id ─────────────────────────

def test_x_tenant_id_non_numeric_returns_400(db_session_tm):
    _seed_tenants(db_session_tm)
    sa = _make_client(db_session_tm, _superadmin_payload())
    try:
        resp = sa.get("/tecnici", headers={"X-Tenant-Id": "abc"})
        assert resp.status_code == 400, f"Atteso 400 per header non numerico, ottenuto {resp.status_code}: {resp.text}"
    finally:
        app.dependency_overrides.clear()


def test_x_tenant_id_nonexistent_returns_404(db_session_tm):
    _seed_tenants(db_session_tm)
    sa = _make_client(db_session_tm, _superadmin_payload())
    try:
        resp = sa.get("/tecnici", headers={"X-Tenant-Id": "424242"})
        assert resp.status_code == 404, f"Atteso 404 per tenant inesistente, ottenuto {resp.status_code}: {resp.text}"
        assert "non trovato" in resp.json().get("detail", "")
    finally:
        app.dependency_overrides.clear()


def test_x_tenant_id_valid_switches_context(db_session_tm):
    t1, t2 = _seed_tenants(db_session_tm)
    from backend.db.modelli import Tecnico
    db_session_tm.add(Tecnico(nome="Solo T2", competenze="Meccanico", stato="in servizio", tenant_id=t2))
    db_session_tm.commit()

    sa = _make_client(db_session_tm, _superadmin_payload())
    try:
        r1 = sa.get("/tecnici", headers={"X-Tenant-Id": str(t1)})
        r2 = sa.get("/tecnici", headers={"X-Tenant-Id": str(t2)})
        assert r1.status_code == 200 and r2.status_code == 200
        nomi_t1 = [t["nome"] for t in r1.json()]
        nomi_t2 = [t["nome"] for t in r2.json()]
        assert "Solo T2" not in nomi_t1
        assert "Solo T2" in nomi_t2
    finally:
        app.dependency_overrides.clear()
