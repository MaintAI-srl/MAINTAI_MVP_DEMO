"""
Validazione contenuto file upload tramite magic bytes (file signature).

Difesa contro upload di contenuti che falsificano l'estensione: l'estensione
nel nome file è controllata altrove tramite whitelist, qui verifichiamo che
i primi byte del contenuto corrispondano effettivamente al tipo dichiarato.

Le estensioni testuali (.txt, .csv) non hanno una firma binaria affidabile:
per quelle si accetta sull'estensione (già in whitelist).
"""
import os
from typing import Optional

# Estensione → lista di (signature, offset) accettabili
_MAGIC: dict[str, list[tuple[bytes, int]]] = {
    ".pdf": [(b"%PDF", 0)],
    ".png": [(b"\x89PNG\r\n\x1a\n", 0)],
    ".jpg": [(b"\xff\xd8\xff", 0)],
    ".jpeg": [(b"\xff\xd8\xff", 0)],
    ".gif": [(b"GIF87a", 0), (b"GIF89a", 0)],
    ".webp": [(b"RIFF", 0)],  # RIFF....WEBP
    ".zip": [(b"PK\x03\x04", 0), (b"PK\x05\x06", 0), (b"PK\x07\x08", 0)],
    ".docx": [(b"PK\x03\x04", 0)],  # OOXML = zip container
    ".xlsx": [(b"PK\x03\x04", 0)],
    ".doc": [(b"\xd0\xcf\x11\xe0", 0)],  # OLE2 compound
    ".xls": [(b"\xd0\xcf\x11\xe0", 0)],
    ".mp4": [(b"ftyp", 4)],
    ".mov": [(b"ftyp", 4), (b"moov", 4), (b"mdat", 4), (b"free", 4), (b"wide", 4)],
}


def _matches(content: bytes, ext: str) -> bool:
    sigs = _MAGIC.get(ext)
    if not sigs:
        return True  # estensione senza firma binaria verificabile
    head = content[:32]
    return any(head[off:off + len(sig)] == sig for sig, off in sigs)


def magic_bytes_mismatch(filename: Optional[str], content: bytes) -> Optional[str]:
    """
    Ritorna un messaggio d'errore se i magic bytes NON corrispondono
    all'estensione dichiarata, altrimenti None (contenuto coerente o
    estensione non verificabile).
    """
    ext = os.path.splitext(filename or "")[1].lower()
    if _matches(content, ext):
        return None
    return f"Il contenuto del file non corrisponde all'estensione dichiarata ('{ext}')."


def is_pdf(filename: Optional[str], content: bytes) -> bool:
    """True se il file ha estensione .pdf e magic bytes %PDF."""
    ext = os.path.splitext(filename or "")[1].lower()
    return ext == ".pdf" and content[:4] == b"%PDF"
