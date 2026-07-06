"""
Test sicurezza upload allegati — P1 Security Findings.

Verifica:
1. HTML rinominato .png rifiutato (POST allegati)
2. HTML rinominato .pdf rifiutato (POST allegati)
3. Estensione vuota rifiutata (POST allegati)
4. Firma base64 con contenuto non-PNG rifiutata (POST firma)
5. Firma PNG valida accettata (POST firma)
6. xlsx fasullo (testo) rifiutato (bulk import preview)
7. Download allegato di altro tenant → 404

Eseguibili con:
JWT_SECRET=testkeytestkeytestkeytestkeytestkey123 \\
ENCRYPTION_KEY=3r5pKVqwiYFRHvvHWRXpTf4SSHAxv0NeZoAkzXam2UQ= \\
/tmp/venv/bin/python -m pytest backend/tests/test_upload_security.py -v
"""
from __future__ import annotations

import base64
import struct

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.core.database import Base
from backend.core.dependencies import get_db
from backend.core.security import get_current_user_payload, get_current_tenant_id
from backend.db.modelli import Tenant, Asset, Impianto, Sito, Ticket, TicketAllegato
from backend.main import app


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

TEST_DB_URL = "sqlite:///:memory:"


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
    """Restituisce un TestClient con auth simulata (dipendenze override)."""
    from backend.core.rate_limiter import limiter as _rl
    _rl.enabled = False

    payload = {"sub": "test_user", "ruolo": ruolo, "tenant_id": tenant_id}

    app.dependency_overrides[get_db] = lambda: (yield db_session)
    app.dependency_overrides[get_current_user_payload] = lambda: payload
    app.dependency_overrides[get_current_tenant_id] = lambda: tenant_id

    return TestClient(app, base_url="https://testserver", headers={"origin": "http://localhost:3000"})


def _seed_ticket(db_session, tenant_id: int = 1) -> int:
    """Crea il minimo indispensabile (Tenant → Sito → Impianto → Asset → Ticket) e ritorna ticket.id."""
    # Tenant
    tenant = db_session.query(Tenant).filter_by(id=tenant_id).first()
    if not tenant:
        tenant = Tenant(id=tenant_id, nome=f"Tenant{tenant_id}", slug=f"tenant{tenant_id}", is_active=True)
        db_session.add(tenant)
        db_session.flush()

    sito = Sito(nome="Sito Test", tenant_id=tenant_id)
    db_session.add(sito)
    db_session.flush()

    imp = Impianto(nome="Impianto Test", sito_id=sito.id, tenant_id=tenant_id)
    db_session.add(imp)
    db_session.flush()

    asset = Asset(nome="Asset Test", area="A1", impianto_id=imp.id, tenant_id=tenant_id)
    db_session.add(asset)
    db_session.flush()

    ticket = Ticket(
        titolo="Ticket Test",
        asset_id=asset.id,
        tipo="BD",
        priorita="Alta",
        stato="Aperto",
        tenant_id=tenant_id,
        durata_stimata_ore=1.0,
        fascia_oraria="mattina",
    )
    db_session.add(ticket)
    db_session.commit()
    db_session.refresh(ticket)
    return ticket.id


# ---------------------------------------------------------------------------
# Magic bytes helpers
# ---------------------------------------------------------------------------

def _html_bytes() -> bytes:
    return b"<html><body>XSS test</body></html>"


def _png_bytes() -> bytes:
    """PNG minimo valido (1×1 pixel, transparte)."""
    # Header PNG
    png_header = b"\x89PNG\r\n\x1a\n"
    # IHDR chunk: 13 bytes data
    ihdr_data = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    ihdr_crc = _crc32(b"IHDR" + ihdr_data)
    ihdr_chunk = struct.pack(">I", 13) + b"IHDR" + ihdr_data + struct.pack(">I", ihdr_crc)
    # IDAT chunk: deflate compressed scanline
    import zlib
    raw_data = b"\x00\xff\xff\xff"  # filter byte + RGB pixel
    compressed = zlib.compress(raw_data)
    idat_crc = _crc32(b"IDAT" + compressed)
    idat_chunk = struct.pack(">I", len(compressed)) + b"IDAT" + compressed + struct.pack(">I", idat_crc)
    # IEND chunk
    iend_crc = _crc32(b"IEND")
    iend_chunk = struct.pack(">I", 0) + b"IEND" + struct.pack(">I", iend_crc)
    return png_header + ihdr_chunk + idat_chunk + iend_chunk


def _crc32(data: bytes) -> int:
    import zlib
    return zlib.crc32(data) & 0xFFFFFFFF


def _pdf_bytes() -> bytes:
    return b"%PDF-1.4 minimal\n%%EOF"


def _zip_bytes() -> bytes:
    """Byte minimo di un file ZIP (PK header)."""
    return b"PK\x03\x04" + b"\x00" * 26  # end of central directory segue dopo, non serve per magic


# ---------------------------------------------------------------------------
# Test 1: HTML rinominato .png → rifiutato
# ---------------------------------------------------------------------------

def test_html_renamed_png_rejected(db_session):
    ticket_id = _seed_ticket(db_session)
    client = _make_client(db_session)

    files = {"file": ("malicious.png", _html_bytes(), "image/png")}
    resp = client.post(f"/tickets/{ticket_id}/allegati", files=files)

    assert resp.status_code == 400, f"Atteso 400, ricevuto {resp.status_code}: {resp.text}"
    detail = resp.json().get("detail", "")
    # Deve contenere riferimento al contenuto non valido o estensione non corrispondente
    assert any(
        kw in detail.lower()
        for kw in ["non valido", "non corrisponde", "tipo file", "magic", "png", "html"]
    ), f"Messaggio di errore inatteso: {detail}"


# ---------------------------------------------------------------------------
# Test 2: HTML rinominato .pdf → rifiutato
# ---------------------------------------------------------------------------

def test_html_renamed_pdf_rejected(db_session):
    ticket_id = _seed_ticket(db_session)
    client = _make_client(db_session)

    files = {"file": ("fake.pdf", _html_bytes(), "application/pdf")}
    resp = client.post(f"/tickets/{ticket_id}/allegati", files=files)

    assert resp.status_code == 400, f"Atteso 400, ricevuto {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# Test 3: Estensione vuota → rifiutata
# ---------------------------------------------------------------------------

def test_empty_extension_rejected(db_session):
    ticket_id = _seed_ticket(db_session)
    client = _make_client(db_session)

    files = {"file": ("noextension", b"some content", "application/octet-stream")}
    resp = client.post(f"/tickets/{ticket_id}/allegati", files=files)

    assert resp.status_code == 400, f"Atteso 400, ricevuto {resp.status_code}: {resp.text}"
    detail = resp.json().get("detail", "")
    assert any(
        kw in detail.lower()
        for kw in ["estensione", "mancante", "non consentit"]
    ), f"Messaggio di errore inatteso: {detail}"


# ---------------------------------------------------------------------------
# Test 4: Firma base64 con contenuto non-PNG → rifiutata
# ---------------------------------------------------------------------------

def test_firma_non_png_rejected(db_session):
    ticket_id = _seed_ticket(db_session)
    client = _make_client(db_session)

    fake_content = b"%PDF-1.4 fake"
    b64 = base64.b64encode(fake_content).decode()

    resp = client.post(f"/tickets/{ticket_id}/firma", json={"image": b64})
    assert resp.status_code == 400, f"Atteso 400, ricevuto {resp.status_code}: {resp.text}"
    detail = resp.json().get("detail", "")
    assert any(
        kw in detail.lower()
        for kw in ["png", "non valida", "non è un'immagine"]
    ), f"Messaggio di errore inatteso: {detail}"


# ---------------------------------------------------------------------------
# Test 5: Firma PNG valida → accettata (verifica solo che non rifiuti)
# ---------------------------------------------------------------------------

def test_firma_png_valid_accepted(db_session, tmp_path):
    ticket_id = _seed_ticket(db_session)
    client = _make_client(db_session)

    png_content = _png_bytes()
    b64 = base64.b64encode(png_content).decode()

    resp = client.post(f"/tickets/{ticket_id}/firma", json={"image": b64})
    # Deve andare a buon fine (200) oppure fallire solo se storage non disponibile
    # In test la save_file scrive su filesystem locale
    assert resp.status_code in (200, 201), f"Atteso 200/201, ricevuto {resp.status_code}: {resp.text}"


# ---------------------------------------------------------------------------
# Test 6: xlsx fasullo (contenuto testuale) → rifiutato su bulk import preview
# ---------------------------------------------------------------------------

def test_xlsx_fake_rejected_bulk_import(db_session):
    """Un file .xlsx con contenuto testuale (non ZIP) deve essere rifiutato."""
    from backend.core.rate_limiter import limiter as _rl
    _rl.enabled = False

    payload_sa = {"sub": "superadmin", "ruolo": "superadmin", "tenant_id": None}
    tenant_id = 1

    # Assicura che il tenant esista
    t = db_session.query(Tenant).filter_by(id=tenant_id).first()
    if not t:
        db_session.add(Tenant(id=tenant_id, nome="Tenant1", slug="tenant1", is_active=True))
        db_session.commit()

    app.dependency_overrides[get_db] = lambda: (yield db_session)
    app.dependency_overrides[get_current_user_payload] = lambda: payload_sa
    app.dependency_overrides[get_current_tenant_id] = lambda: None

    try:
        from backend.core.security import require_superadmin
        app.dependency_overrides[require_superadmin] = lambda: payload_sa
    except Exception:
        pass

    client = TestClient(app, base_url="https://testserver", headers={"origin": "http://localhost:3000"})

    fake_xlsx_content = b"questo e un file di testo, non un xlsx valido"
    files = {"file": ("import.xlsx", fake_xlsx_content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    data = {"tenant_id": str(tenant_id)}

    resp = client.post("/admin/bulk-import/preview", files=files, data=data)
    # Deve essere 400 (tipo file non valido), non 422 (errori foglio mancante)
    assert resp.status_code == 400, f"Atteso 400, ricevuto {resp.status_code}: {resp.text}"
    detail = resp.json().get("detail", "")
    assert any(
        kw in detail.lower()
        for kw in ["non valido", "zip", "xlsx", "magic", "famiglia"]
    ), f"Messaggio di errore inatteso: {detail}"


# ---------------------------------------------------------------------------
# Test 7: Download allegato di altro tenant → 404
# ---------------------------------------------------------------------------

def test_download_allegato_altro_tenant_404(db_session):
    """Un tenant non deve poter scaricare allegati di un altro tenant."""
    # Crea ticket per tenant 1
    ticket_id_t1 = _seed_ticket(db_session, tenant_id=1)
    # Aggiungi un allegato finto per tenant 1
    allegato = TicketAllegato(
        ticket_id=ticket_id_t1,
        nome_file="test.pdf",
        percorso="uploads/nonexistent_test.pdf",
        tipo_mime="application/pdf",
        dimensione_bytes=100,
        tenant_id=1,
    )
    db_session.add(allegato)
    db_session.commit()
    db_session.refresh(allegato)
    allegato_id = allegato.id

    # Accede come tenant 2 — deve ricevere 404
    client_t2 = _make_client(db_session, tenant_id=2)
    resp = client_t2.get(f"/tickets/allegati/{allegato_id}/download")
    assert resp.status_code == 404, (
        f"Tenant 2 non dovrebbe vedere l'allegato del tenant 1. "
        f"Ricevuto {resp.status_code}: {resp.text}"
    )


# ---------------------------------------------------------------------------
# Test 8: validate_upload unit tests (senza HTTP layer)
# ---------------------------------------------------------------------------

def test_validate_upload_unit_html_as_png():
    """validate_upload deve rifiutare HTML rinominato PNG."""
    from backend.core.file_validation import validate_upload
    with pytest.raises(ValueError, match=r"(?i)(non corrisponde|magic|tipo file|png|riconosciuto)"):
        validate_upload(_html_bytes(), "test.png", {"png", "jpg", "pdf"})


def test_validate_upload_unit_no_extension():
    """validate_upload deve rifiutare filename senza estensione."""
    from backend.core.file_validation import validate_upload
    with pytest.raises(ValueError, match=r"(?i)(estensione|mancante)"):
        validate_upload(b"some data", "noextension", {"png", "jpg", "pdf"})


def test_validate_upload_unit_html_as_csv():
    """validate_upload deve rifiutare HTML rinominato CSV."""
    from backend.core.file_validation import validate_upload
    html_content = b"<html><script>alert(1)</script></html>"
    with pytest.raises(ValueError, match=r"(?i)(html|script|markup)"):
        validate_upload(html_content, "data.csv", {"csv", "txt"})


def test_validate_upload_unit_valid_png():
    """validate_upload deve accettare PNG valido."""
    from backend.core.file_validation import validate_upload
    ext = validate_upload(_png_bytes(), "image.png", {"png", "jpg", "pdf"})
    assert ext == "png"


def test_validate_upload_unit_valid_pdf():
    """validate_upload deve accettare PDF valido."""
    from backend.core.file_validation import validate_upload
    ext = validate_upload(_pdf_bytes(), "doc.pdf", {"pdf", "png"})
    assert ext == "pdf"


def test_validate_upload_unit_zip_family():
    """validate_upload deve accettare xlsx (famiglia ZIP)."""
    from backend.core.file_validation import validate_upload
    zip_content = _zip_bytes()
    ext = validate_upload(zip_content, "file.xlsx", {"xlsx", "docx", "zip"})
    assert ext == "xlsx"


def test_validate_upload_unit_binary_as_txt():
    """validate_upload deve rifiutare contenuto binario rinominato .txt."""
    from backend.core.file_validation import validate_upload
    with pytest.raises(ValueError, match=r"(?i)(binario|binari)"):
        validate_upload(_pdf_bytes(), "readme.txt", {"txt", "csv"})
