"""
Validazione e serving sicuro dei file caricati dagli utenti.

Responsabilità:
1. `validate_magic()` — verifica che i magic bytes del contenuto corrispondano
   all'estensione dichiarata e a un set di tipi ammessi (difesa contro file
   "travestiti", es. HTML rinominato .png). Firma invariata (retrocompatibilità).
2. `validate_upload()` — validazione completa: whitelist estensione, magic bytes
   (dove applicabile), protezione da contenuto HTML/script per file testuali.
3. `safe_serving()` — calcola Content-Type e Content-Disposition sicuri per il
   download IGNORANDO il content_type fornito dal client (anti stored-XSS):
   solo le immagini note possono essere servite `inline`, tutto il resto è
   forzato a `attachment`.

Nessuna dipendenza esterna: i magic bytes sono verificati a mano.
"""
from __future__ import annotations

import os

# ---------------------------------------------------------------------------
# Firme magic bytes (prefisso del file) → estensione canonica
# ---------------------------------------------------------------------------
_MAGIC: list[tuple[bytes, str]] = [
    (b"%PDF-", "pdf"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
    # GIF: GIF87a o GIF89a
    (b"GIF87a", "gif"),
    (b"GIF89a", "gif"),
    # RIFF/WEBP: byte 0-3 = "RIFF", byte 8-11 = "WEBP"  (verificato sotto in sniff_ext)
    # ZIP family (xlsx, docx, zip): PK\x03\x04
    (b"PK\x03\x04", "zip"),
    # OLE2 (doc, xls legacy): D0 CF 11 E0
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "ole2"),
    # MP4/MOV: "ftyp" a offset 4 (verificato sotto in sniff_ext)
]

# Firme binarie note — usate per proteggere i file "non sniffabili" (csv/txt)
_ALL_BINARY_SIGNATURES: list[bytes] = [sig for sig, _ in _MAGIC] + [b"RIFF"]

# Estensione canonica → (MIME sicuro, inline consentito in download)
_EXT_MIME: dict[str, tuple[str, bool]] = {
    "pdf":  ("application/pdf", True),
    "png":  ("image/png", True),
    "jpg":  ("image/jpeg", True),
    "jpeg": ("image/jpeg", True),
    "gif":  ("image/gif", True),
    "webp": ("image/webp", True),
    "doc":  ("application/msword", False),
    "xls":  ("application/vnd.ms-excel", False),
    "docx": ("application/vnd.openxmlformats-officedocument.wordprocessingml.document", False),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", False),
    "zip":  ("application/zip", False),
    "csv":  ("text/csv", False),
    "txt":  ("text/plain", False),
    "mp4":  ("video/mp4", False),
    "mov":  ("video/quicktime", False),
}

# Estensioni che condividono la firma PK (zip family)
_ZIP_FAMILY = {"xlsx", "docx", "zip"}
# Estensioni che condividono la firma OLE2 (Office legacy)
_OLE2_FAMILY = {"doc", "xls"}
# Estensioni non-sniffabili (nessuna firma magic affidabile)
_TEXT_EXTS = {"csv", "txt"}
# Estensioni video (sniff tramite "ftyp" a offset 4)
_VIDEO_EXTS = {"mp4", "mov"}

# Marker HTML/script da cercare nei file testuali (case-insensitive, primi 4 KB)
_HTML_MARKERS = [b"<script", b"<html", b"<!doctype html", b"<iframe"]
_HTML_SNIFF_BYTES = 4096


def sniff_ext(content: bytes) -> str | None:
    """
    Ritorna l'estensione canonica dedotta dai magic bytes, o None se sconosciuta.

    Gestisce i casi speciali:
    - WEBP: RIFF....WEBP (offset 0 = "RIFF", offset 8 = "WEBP")
    - MP4/MOV: "ftyp" a offset 4 (byte 4-7)
    - ZIP family e OLE2: restituisce il tipo generico ("zip" / "ole2")
    """
    # Caso speciale: WEBP
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "webp"

    # Caso speciale: MP4/MOV ("ftyp" a offset 4)
    if len(content) >= 8 and content[4:8] == b"ftyp":
        return "mp4"

    for signature, ext in _MAGIC:
        if content.startswith(signature):
            return ext
    return None


def file_extension(filename: str | None) -> str:
    """Estensione (senza punto, minuscola) del filename dichiarato."""
    return os.path.splitext((filename or "").lower())[1].lstrip(".")


def sanitize_filename_header(filename: str | None) -> str:
    """Rimuove caratteri pericolosi per l'header Content-Disposition (header injection)."""
    raw = filename or "file"
    cleaned = raw.replace('"', "").replace("\n", "").replace("\r", "").strip()
    return cleaned or "file"


def validate_magic(content: bytes, filename: str | None, allowed_exts: set[str]) -> str:
    """
    Verifica che il contenuto sia un tipo ammesso e coerente con l'estensione dichiarata.
    `allowed_exts` accetta estensioni con o senza punto (es. {".pdf", "png"}).
    Solleva ValueError in caso di mismatch o tipo non ammesso. Ritorna l'estensione canonica.

    Nota: questa funzione è mantenuta per retrocompatibilità con asset_documenti.py e
    altri chiamanti esistenti. La firma NON deve cambiare.
    """
    allowed = {e.lstrip(".").lower() for e in allowed_exts}
    if "jpeg" in allowed:
        allowed.add("jpg")

    detected = sniff_ext(content)
    if detected is None:
        raise ValueError("Tipo file non riconosciuto: contenuto non valido o non supportato.")
    if detected not in allowed:
        raise ValueError(f"Tipo file non ammesso (rilevato: {detected}).")

    declared = file_extension(filename)
    declared = "jpg" if declared == "jpeg" else declared
    if declared and declared != detected:
        raise ValueError(
            f"L'estensione dichiarata ('{declared}') non corrisponde al contenuto reale ('{detected}')."
        )
    return detected


def validate_upload(content: bytes, filename: str | None, allowed_exts: set[str]) -> str:
    """
    Validazione completa di un file caricato dall'utente.

    Controlli eseguiti:
    1. Estensione presente e in whitelist (rifiuta filename senza estensione).
    2. Per tipi binari sniffabili: coerenza magic-bytes ↔ estensione dichiarata.
       - ZIP family (xlsx/docx/zip): condividono la firma PK → accettate tutte.
       - OLE2 family (doc/xls): condividono la firma OLE2 → accettate tutte.
       - Video (mp4/mov): condividono la firma ftyp → accettate tutte.
    3. Per csv/txt (non sniffabili da magic): rifiuta se il contenuto matcha una
       firma binaria nota, rifiuta se contiene marker HTML/script nei primi 4 KB,
       richiede che sia decodificabile come testo (utf-8 o latin-1).

    `allowed_exts` accetta estensioni con o senza punto (es. {".pdf", "png"}).
    Solleva ValueError con messaggio chiaro in caso di rifiuto.
    Ritorna l'estensione canonica (senza punto, minuscola).
    """
    allowed = {e.lstrip(".").lower() for e in allowed_exts}
    # Normalizza alias jpeg→jpg
    if "jpeg" in allowed:
        allowed.add("jpg")

    # 1. Estensione obbligatoria e in whitelist
    declared_raw = file_extension(filename)
    # Normalizza jpeg→jpg per coerenza
    declared = "jpg" if declared_raw == "jpeg" else declared_raw

    if not declared:
        raise ValueError(
            "Estensione file mancante: il file deve avere un'estensione valida "
            f"({', '.join(sorted(allowed))})."
        )
    if declared not in allowed:
        raise ValueError(
            f"Estensione '{declared}' non consentita. "
            f"Estensioni ammesse: {', '.join(sorted(allowed))}."
        )

    # 2. File testuali non sniffabili (csv, txt)
    if declared in _TEXT_EXTS:
        _validate_text_content(content, declared)
        return declared

    # 3. File binari sniffabili
    detected = sniff_ext(content)

    # Gruppi di estensioni che condividono la stessa firma magic
    if declared in _ZIP_FAMILY:
        if detected != "zip":
            raise ValueError(
                f"Il contenuto del file non corrisponde a un file '{declared}' valido "
                f"(firma attesa: PK\\x03\\x04)."
            )
        return declared

    if declared in _OLE2_FAMILY:
        if detected != "ole2":
            raise ValueError(
                f"Il contenuto del file non corrisponde a un file '{declared}' valido "
                f"(firma OLE2 attesa)."
            )
        return declared

    if declared in _VIDEO_EXTS:
        if detected != "mp4":
            raise ValueError(
                f"Il contenuto del file non corrisponde a un file video valido "
                f"(firma 'ftyp' attesa a offset 4)."
            )
        return declared

    # GIF e WEBP: mapping diretto dichiarato→rilevato
    if detected is None:
        raise ValueError(
            f"Tipo file non riconosciuto dai magic bytes: "
            f"il file potrebbe essere danneggiato o di tipo non supportato."
        )

    # Normalizza jpeg→jpg anche nel rilevato
    if detected == "jpeg":
        detected = "jpg"

    if declared != detected:
        raise ValueError(
            f"L'estensione dichiarata ('{declared}') non corrisponde al contenuto "
            f"reale del file (rilevato: '{detected}'). "
            f"Potrebbe essere un file mascherato."
        )

    return declared


def _validate_text_content(content: bytes, ext: str) -> None:
    """
    Valida un file testuale (csv/txt):
    - Rifiuta se inizia con una firma binaria nota.
    - Rifiuta se contiene marker HTML/script nei primi 4 KB.
    - Rifiuta se non è decodificabile come testo (utf-8 o latin-1).
    """
    # Rifiuta se inizia con firma binaria nota
    for sig in _ALL_BINARY_SIGNATURES:
        if content.startswith(sig):
            raise ValueError(
                f"Il file '{ext}' contiene contenuto binario non valido per un file testuale."
            )

    # Controlla marker HTML nei primi _HTML_SNIFF_BYTES byte
    sniff = content[:_HTML_SNIFF_BYTES].lower()
    for marker in _HTML_MARKERS:
        if marker in sniff:
            raise ValueError(
                f"Il file '{ext}' contiene markup HTML o script non consentito."
            )

    # Deve essere decodificabile come testo
    for enc in ("utf-8", "latin-1"):
        try:
            content.decode(enc)
            return
        except (UnicodeDecodeError, LookupError):
            continue
    raise ValueError(
        f"Il file '{ext}' non è decodificabile come testo valido (utf-8 o latin-1)."
    )


# Caratteri iniziali che Excel/LibreOffice interpretano come formula (CSV/formula injection,
# CWE-1236). Il tab e il CR/LF coprono le varianti con whitespace iniziale.
_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def sanitize_spreadsheet_cell(value):
    """
    Neutralizza la formula injection nei valori esportati verso CSV/Excel.
    Se una stringa inizia con un carattere formula (=, +, -, @, tab, CR) viene
    prefissata con un apostrofo: Excel la tratta come testo letterale.
    I valori non-stringa passano invariati.
    """
    if isinstance(value, str) and value.startswith(_FORMULA_PREFIXES):
        return "'" + value
    return value


def safe_serving(filename: str | None, _client_content_type: str | None = None) -> tuple[str, str]:
    """
    Ritorna (content_type sicuro, disposition) per il download.
    Il content_type del client viene IGNORATO di proposito: si usa una whitelist
    basata sull'estensione. Le immagini note possono essere `inline`, tutto il
    resto è forzato a `attachment` per prevenire stored XSS.
    """
    ext = file_extension(filename)
    mime, inline_ok = _EXT_MIME.get(ext, ("application/octet-stream", False))
    return mime, ("inline" if inline_ok else "attachment")
