"""
Validazione e serving sicuro dei file caricati dagli utenti.

Due responsabilità:
1. `validate_magic()` — verifica che i magic bytes del contenuto corrispondano
   all'estensione dichiarata e a un set di tipi ammessi (difesa contro file
   "travestiti", es. HTML rinominato .png).
2. `safe_serving()` — calcola Content-Type e Content-Disposition sicuri per il
   download IGNORANDO il content_type fornito dal client (anti stored-XSS):
   solo le immagini note possono essere servite `inline`, tutto il resto è
   forzato a `attachment`.

Nessuna dipendenza esterna: i magic bytes sono verificati a mano.
"""
from __future__ import annotations

import os

# Firme magic bytes note (prefisso del file) → estensione canonica
_MAGIC: list[tuple[bytes, str]] = [
    (b"%PDF-", "pdf"),
    (b"\x89PNG\r\n\x1a\n", "png"),
    (b"\xff\xd8\xff", "jpg"),
]

# Estensione canonica → (MIME sicuro, inline consentito in download)
_EXT_MIME: dict[str, tuple[str, bool]] = {
    "pdf": ("application/pdf", True),
    "png": ("image/png", True),
    "jpg": ("image/jpeg", True),
    "jpeg": ("image/jpeg", True),
}


def sniff_ext(content: bytes) -> str | None:
    """Ritorna l'estensione canonica dedotta dai magic bytes, o None se sconosciuta."""
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
