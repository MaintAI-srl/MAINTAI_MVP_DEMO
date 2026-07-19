"""
Test del rapportino PDF con firma di accettazione.

- POST /tickets/{id}/firma registra nome firmatario e data
- GET  /tickets/{id}/rapportino.pdf genera un PDF valido (inline / attachment)
- Il PDF con firma embedded si genera senza errori
- Isolamento tenant: rapportino di altro tenant → 404
- Il servizio build_ticket_report_pdf produce byte %PDF

Eseguibili con:
JWT_SECRET=testkeytestkeytestkeytestkeytestkey123 \\
ENCRYPTION_KEY=3r5pKVqwiYFRHvvHWRXpTf4SSHAxv0NeZoAkzXam2UQ= \\
python -m pytest backend/tests/test_ticket_rapportino.py -v
"""
from __future__ import annotations

import base64
import struct
import zlib

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.database import Base
from backend.core.dependencies import get_db
from backend.core.security import get_current_user_payload, get_current_tenant_id
from backend.db.modelli import Tenant, Asset, Impianto, Sito, Ticket
from backend.main import app


TEST_DB_URL = "sqlite:///:memory:"


def _crc32(data: bytes) -> int:
    return zlib.crc32(data) & 0xFFFFFFFF


def _png_bytes() -> bytes:
    png_header = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    ihdr_chunk = struct.pack(">I", 13) + b"IHDR" + ihdr_data + struct.pack(">I", _crc32(b"IHDR" + ihdr_data))
    raw_data = b"\x00\xff\xff\xff"
    compressed = zlib.compress(raw_data)
    idat_chunk = struct.pack(">I", len(compressed)) + b"IDAT" + compressed + struct.pack(">I", _crc32(b"IDAT" + compressed))
    iend_chunk = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", _crc32(b"IEND"))
    return png_header + ihdr_chunk + idat_chunk + iend_chunk


@pytest.fixture(scope="module")
def _engine():
    engine = create_engine(TEST_DB_URL, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db_session(_engine):
    conn = _engine.connect()
    tx = conn.begin()
    Session = sessionmaker(bind=conn)
    session = Session()
    yield session
    session.close()
    tx.rollback()
    conn.close()


def _make_client(db_session, tenant_id: int = 1, ruolo: str = "responsabile") -> TestClient:
    from backend.core.rate_limiter import limiter as _rl
    _rl.enabled = False
    payload = {"sub": "test_user", "ruolo": ruolo, "tenant_id": tenant_id}
    app.dependency_overrides[get_db] = lambda: (yield db_session)
    app.dependency_overrides[get_current_user_payload] = lambda: payload
    app.dependency_overrides[get_current_tenant_id] = lambda: tenant_id
    return TestClient(app, base_url="https://testserver", headers={"origin": "http://localhost:3000"})


def _seed_ticket(db_session, tenant_id: int = 1) -> int:
    tenant = db_session.query(Tenant).filter_by(id=tenant_id).first()
    if not tenant:
        tenant = Tenant(id=tenant_id, nome=f"Azienda{tenant_id}", slug=f"azienda{tenant_id}", is_active=True)
        db_session.add(tenant)
        db_session.flush()
    sito = Sito(nome="Sito Nord", tenant_id=tenant_id)
    db_session.add(sito)
    db_session.flush()
    imp = Impianto(nome="Linea 1", sito_id=sito.id, tenant_id=tenant_id)
    db_session.add(imp)
    db_session.flush()
    asset = Asset(nome="Compressore A", codice="CMP-001", area="A1", impianto_id=imp.id, tenant_id=tenant_id)
    db_session.add(asset)
    db_session.flush()
    ticket = Ticket(
        titolo="Sostituzione cuscinetto", asset_id=asset.id, tipo="CM", priorita="Alta",
        stato="Chiuso", tenant_id=tenant_id, durata_stimata_ore=2.0, fascia_oraria="mattina",
        descrizione="Rumore anomalo", sito_name="Sito Nord", impianto_name="Linea 1",
    )
    db_session.add(ticket)
    db_session.commit()
    db_session.refresh(ticket)
    return ticket.id


def test_rapportino_pdf_senza_firma(db_session):
    ticket_id = _seed_ticket(db_session)
    client = _make_client(db_session)
    resp = client.get(f"/tickets/{ticket_id}/rapportino.pdf")
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"] == "application/pdf"
    assert "inline" in resp.headers.get("content-disposition", "")
    assert resp.content[:4] == b"%PDF"


def test_rapportino_pdf_download_attachment(db_session):
    ticket_id = _seed_ticket(db_session)
    client = _make_client(db_session)
    resp = client.get(f"/tickets/{ticket_id}/rapportino.pdf?download=true")
    assert resp.status_code == 200, resp.text
    assert "attachment" in resp.headers.get("content-disposition", "")


def test_firma_con_nome_e_rapportino(db_session):
    ticket_id = _seed_ticket(db_session)
    client = _make_client(db_session)

    b64 = base64.b64encode(_png_bytes()).decode()
    resp = client.post(f"/tickets/{ticket_id}/firma", json={"image": b64, "nome": "Giuseppe Verdi"})
    assert resp.status_code in (200, 201), resp.text
    assert resp.json().get("firma_nome") == "Giuseppe Verdi"

    # Il ticket ora ha nome + data firma
    tk = db_session.query(Ticket).filter_by(id=ticket_id).first()
    assert tk.firma_nome == "Giuseppe Verdi"
    assert tk.firma_data is not None
    assert tk.firma_percorso

    # Il PDF si genera con la firma embedded
    resp = client.get(f"/tickets/{ticket_id}/rapportino.pdf")
    assert resp.status_code == 200, resp.text
    assert resp.content[:4] == b"%PDF"


def test_rapportino_altro_tenant_404(db_session):
    ticket_id = _seed_ticket(db_session, tenant_id=1)
    # Client autenticato come tenant 2 → non deve vedere il ticket del tenant 1
    client = _make_client(db_session, tenant_id=2)
    resp = client.get(f"/tickets/{ticket_id}/rapportino.pdf")
    assert resp.status_code == 404, f"Atteso 404 cross-tenant, ottenuto {resp.status_code}"


def test_build_pdf_service_diretto():
    from backend.services.ticket_pdf_service import build_ticket_report_pdf
    data = {"id": 1, "azienda": "Acme", "titolo": "Test", "stato": "Chiuso"}
    pdf = build_ticket_report_pdf(data, None)
    assert pdf[:4] == b"%PDF"
    assert len(pdf) > 500
