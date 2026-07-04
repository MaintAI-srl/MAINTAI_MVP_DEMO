"""
Test di regressione — Security Audit v1.3 (2026-07-04).

Copre i finding chiusi in questa sessione:
- SEC-021/SEC-022: pin dipendenze (python-multipart, cryptography) alle versioni corrette
- SEC-024: clamp dei parametri di orizzonte/periodo (anti-DoS CPU)
- SEC-025: neutralizzazione formula injection negli export CSV/Excel (CWE-1236)
- SEC-026: cap della cache geocoding in-memory (anti memory-exhaustion)
- SEC-027: rate limit su /auth/change-password

Eseguibili con: JWT_SECRET=... ENCRYPTION_KEY=... python -m pytest backend/tests/test_security_audit_v13.py -v
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.database import Base
from backend.core.dependencies import get_db
from backend.core.file_validation import sanitize_spreadsheet_cell
from backend.core.security import get_current_tenant_id, get_current_user_payload
from backend.db.modelli import Tenant, Ticket
from backend.main import app

REQUIREMENTS = Path(__file__).resolve().parents[1] / "requirements.txt"

TEST_DATABASE_URL = "sqlite:///:memory:"


# ── Fixtures locali (pattern di test_rbac_tickets) ────────────────────────────

@pytest.fixture(scope="module")
def db_engine_sec():
    engine = create_engine(TEST_DATABASE_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session_sec(db_engine_sec):
    connection = db_engine_sec.connect()
    transaction = connection.begin()
    Session = sessionmaker(bind=connection)
    session = Session()
    yield session
    session.close()
    transaction.rollback()
    connection.close()


def _client(db_session, ruolo: str = "responsabile", tenant_id: int = 1) -> TestClient:
    from backend.core.rate_limiter import limiter as _rate_limiter
    _rate_limiter.enabled = False

    payload = {"sub": f"{ruolo}_sec_test", "ruolo": ruolo, "tenant_id": tenant_id}

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user_payload] = lambda: payload
    app.dependency_overrides[get_current_tenant_id] = lambda: tenant_id
    return TestClient(app, base_url="https://testserver", headers={"origin": "http://localhost:3000"})


@pytest.fixture
def tenant_sec(db_session_sec):
    tenant = Tenant(nome="SecAudit", slug="sec-audit-v13")
    db_session_sec.add(tenant)
    db_session_sec.commit()
    return tenant


# ── SEC-021 / SEC-022 — pin dipendenze patchate ───────────────────────────────

def _pinned_version(package: str) -> tuple[int, ...]:
    text = REQUIREMENTS.read_text(encoding="utf-8")
    m = re.search(rf"^{re.escape(package)}==([\d.]+)$", text, re.MULTILINE)
    assert m, f"{package} deve essere pinnato in requirements.txt"
    return tuple(int(x) for x in m.group(1).split("."))


def test_sec021_python_multipart_patched():
    """CVE-2026-53538/53539/53540 corretti da python-multipart >= 0.0.31."""
    assert _pinned_version("python-multipart") >= (0, 0, 31)


def test_sec022_cryptography_patched():
    """GHSA-537c-gmf6-5ccf corretto da cryptography >= 48.0.1."""
    assert _pinned_version("cryptography") >= (48, 0, 1)


# ── SEC-024 — clamp parametri anti-DoS ────────────────────────────────────────

def test_sec024_report_mesi_clamped(db_session_sec, tenant_sec):
    """`mesi` fuori range viene rifiutato con 422 (prima: loop O(mesi) → DoS CPU)."""
    client = _client(db_session_sec, tenant_id=tenant_sec.id)
    try:
        assert client.get("/report/economico?mesi=1000000").status_code == 422
        assert client.get("/report/economico?mesi=0").status_code == 422
        assert client.get("/report/economico?mesi=12").status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_sec024_generate_plan_days_clamped():
    """GeneratePlanRequest.days viene riportato nel range 1..90."""
    from backend.api.routes.planning import GeneratePlanRequest

    assert GeneratePlanRequest(days=10**6).days == 90
    assert GeneratePlanRequest(days=0).days == 1
    assert GeneratePlanRequest(days=-5).days == 1
    assert GeneratePlanRequest(days=7).days == 7


def test_sec024_feedback_analytics_days_clamped(db_session_sec, tenant_sec):
    client = _client(db_session_sec, tenant_id=tenant_sec.id)
    try:
        assert client.get("/planning/feedback/analytics?days=99999").status_code == 422
        assert client.get("/planning/feedback/analytics?days=0").status_code == 422
        assert client.get("/planning/feedback/analytics?days=30").status_code == 200
    finally:
        app.dependency_overrides.clear()


# ── SEC-025 — formula injection CSV/Excel (CWE-1236) ─────────────────────────

@pytest.mark.parametrize(
    "malicious",
    ["=cmd|' /C calc'!A0", "+SUM(1,2)", "-2+3", "@evil", "\tTAB", "\rCR"],
)
def test_sec025_sanitize_cell_neutralizes_formulas(malicious):
    out = sanitize_spreadsheet_cell(malicious)
    assert out == "'" + malicious


def test_sec025_sanitize_cell_passthrough():
    assert sanitize_spreadsheet_cell("Pompa A") == "Pompa A"
    assert sanitize_spreadsheet_cell(42) == 42
    assert sanitize_spreadsheet_cell(None) is None


def test_sec025_csv_export_neutralized(db_session_sec, tenant_sec):
    """Il titolo ostile non deve comparire come formula nel CSV esportato."""
    payload_titolo = "=HYPERLINK(\"http://evil.example\";\"click\")"
    t = Ticket(
        titolo=payload_titolo,
        tipo="BD",
        priorita="Alta",
        stato="Aperto",
        durata_stimata_ore=1.0,
        tenant_id=tenant_sec.id,
    )
    db_session_sec.add(t)
    db_session_sec.commit()

    client = _client(db_session_sec, tenant_id=tenant_sec.id)
    try:
        resp = client.get("/export/tickets")
        assert resp.status_code == 200
        import csv as _csv
        import io as _io
        rows = list(_csv.reader(_io.StringIO(resp.text), delimiter=";"))
        data_rows = [r for r in rows[1:] if len(r) > 1]
        assert data_rows, "export CSV senza righe dati"
        titoli = [r[1] for r in data_rows]
        # Ogni cella-titolo ostile deve essere prefissata con apostrofo,
        # nessuna cella deve iniziare con un carattere formula.
        assert any(t == "'" + payload_titolo for t in titoli)
        assert all(not t.startswith(("=", "+", "@")) for t in titoli)
    finally:
        app.dependency_overrides.clear()


# ── SEC-026 — cap cache geocoding ─────────────────────────────────────────────

def test_sec026_geo_cache_bounded():
    from backend.api.routes import emergency

    emergency._geo_cache.clear()
    for i in range(emergency._GEO_CACHE_MAX + 500):
        emergency._geo_cache_put(f"indirizzo {i}", (float(i % 90), float(i % 180)))
    assert len(emergency._geo_cache) <= emergency._GEO_CACHE_MAX
    # FIFO: le voci più vecchie sono state evitte, l'ultima è presente
    assert f"indirizzo {emergency._GEO_CACHE_MAX + 499}" in emergency._geo_cache
    emergency._geo_cache.clear()


# ── SEC-027 — rate limit su change-password ──────────────────────────────────

def test_sec027_change_password_rate_limited():
    """La route /auth/change-password deve avere il decoratore slowapi."""
    from backend.api.routes.auth import change_password

    # slowapi marca le funzioni decorate con questi attributi
    assert hasattr(change_password, "__wrapped__"), (
        "change_password non risulta decorata con @limiter.limit(...)"
    )
