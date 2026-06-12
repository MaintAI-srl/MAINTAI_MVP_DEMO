"""
Astrazione per il salvataggio e la lettura dei file allegati e firme.

Modalità operative:
- In locale (SUPABASE_URL non configurata): salva in uploads/ e restituisce il
  path interno `uploads/<filename>` (relativo alla CWD del processo backend).
- In cloud (SUPABASE_URL configurata): carica su Supabase Storage e restituisce
  il path interno `uploads/<filename>` (NON l'URL pubblico Supabase).

IMPORTANTE — configurazione Supabase:
  Il bucket indicato da SUPABASE_BUCKET deve essere configurato come PRIVATO
  nella dashboard Supabase (Storage → bucket → impostazioni → accesso privato).
  I file NON devono essere accessibili via URL pubblico; il backend li serve
  tramite gli endpoint autenticati /tickets/allegati/{id}/download e
  /tickets/{ticket_id}/firma.
  Per applicare: Supabase Dashboard → Storage → bucket → Edit → uncheck "Public".

Path traversal protection:
  `read_file()` normalizza il path e verifica che il risultato resti all'interno
  della directory uploads/ (locale) o con prefisso uploads/ (Supabase).
"""

import os

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
STORAGE_BUCKET = os.getenv("SUPABASE_BUCKET", "maintai-uploads")

# Directory locale dove vengono salvati i file (relativa alla CWD del processo)
_LOCAL_UPLOADS_DIR = "uploads"

_client = None


def _get_supabase():
    global _client
    if _client is None and SUPABASE_URL and SUPABASE_SERVICE_KEY:
        from supabase import create_client
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client


def save_file(content: bytes, filename: str) -> str:
    """
    Salva il file e restituisce il path interno (es. 'uploads/<filename>').
    In cloud: carica su Supabase Storage (bucket PRIVATO).
    In locale: scrive su filesystem in uploads/.

    Il path restituito è sempre nella forma 'uploads/<filename>' e viene
    usato come percorso nei record TicketAllegato.percorso e ticket.firma_percorso.
    Non restituisce mai un URL pubblico.
    """
    internal_path = f"{_LOCAL_UPLOADS_DIR}/{filename}"
    client = _get_supabase()
    if client:
        client.storage.from_(STORAGE_BUCKET).upload(
            internal_path, content, {"content-type": "application/octet-stream"}
        )
    else:
        os.makedirs(_LOCAL_UPLOADS_DIR, exist_ok=True)
        filepath = os.path.join(_LOCAL_UPLOADS_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(content)
    return internal_path


def read_file(percorso: str) -> bytes:
    """
    Legge il contenuto di un file dato il suo path interno o URL legacy.

    Gestisce tre formati:
    1. Path interno nuovo: 'uploads/<filename>'  (formato corrente)
    2. Path locale legacy: '/uploads/<filename>' (vecchi record con slash iniziale)
    3. URL pubblico Supabase legacy: 'https://...supabase.co/storage/v1/object/public/<bucket>/uploads/<filename>'

    Protezione path traversal: il path normalizzato deve iniziare con 'uploads/'
    (locale) oppure con il prefisso Supabase. Rifiuta '..' e path assoluti
    inattesi.

    Solleva FileNotFoundError se il file non esiste, ValueError se il path
    è fuori dalla directory uploads/ (path traversal attempt).
    """
    client = _get_supabase()

    # Ricava il path interno dal percorso (gestione retrocompatibilità)
    internal_path = _resolve_internal_path(percorso)

    if client:
        # Download da Supabase Storage
        try:
            data = client.storage.from_(STORAGE_BUCKET).download(internal_path)
            return data
        except Exception as exc:
            raise FileNotFoundError(
                f"File non trovato su Supabase Storage: {internal_path}"
            ) from exc
    else:
        # Filesystem locale — protezione path traversal
        base_dir = os.path.realpath(_LOCAL_UPLOADS_DIR)
        # Rimuovi slash iniziale se presente per costruire il path assoluto
        relative = internal_path.lstrip("/")
        # Il path relativo deve iniziare con uploads/
        if not relative.startswith(f"{_LOCAL_UPLOADS_DIR}/") and relative != _LOCAL_UPLOADS_DIR:
            raise ValueError(f"Path non valido: '{percorso}' è fuori dalla directory uploads.")
        filename_only = relative[len(f"{_LOCAL_UPLOADS_DIR}/"):]
        candidate = os.path.realpath(os.path.join(base_dir, filename_only))
        if not candidate.startswith(base_dir + os.sep) and candidate != base_dir:
            raise ValueError(f"Path traversal rilevato: '{percorso}'.")
        if not os.path.exists(candidate):
            raise FileNotFoundError(f"File non trovato: {candidate}")
        with open(candidate, "rb") as f:
            return f.read()


def _resolve_internal_path(percorso: str) -> str:
    """
    Ricava il path interno 'uploads/<filename>' da qualsiasi formato di percorso.

    Formati supportati:
    - 'uploads/foo.pdf'                    → 'uploads/foo.pdf'
    - '/uploads/foo.pdf'                   → 'uploads/foo.pdf'
    - 'https://.../object/public/<bucket>/uploads/foo.pdf' → 'uploads/foo.pdf'
    - 'https://.../object/public/<bucket>/foo.pdf'         → 'uploads/foo.pdf' (best-effort)
    """
    if not percorso:
        raise ValueError("Percorso file vuoto.")

    # URL pubblico Supabase legacy
    if percorso.startswith("http"):
        marker = f"/object/public/{STORAGE_BUCKET}/"
        if marker in percorso:
            after = percorso.split(marker, 1)[1]
            # Mantieni il path così com'è se include già uploads/
            if after.startswith(f"{_LOCAL_UPLOADS_DIR}/"):
                return after
            # Altrimenti prefissa uploads/
            return f"{_LOCAL_UPLOADS_DIR}/{after}"
        # URL Supabase senza bucket nel marker (fallback)
        # Prendi tutto dopo /storage/v1/object/public/
        marker2 = "/storage/v1/object/public/"
        if marker2 in percorso:
            after = percorso.split(marker2, 1)[1]
            # Rimuovi il nome del bucket dal path
            parts = after.split("/", 1)
            if len(parts) == 2:
                after = parts[1]
            if after.startswith(f"{_LOCAL_UPLOADS_DIR}/"):
                return after
            return f"{_LOCAL_UPLOADS_DIR}/{after}"
        raise ValueError(f"URL Supabase non riconoscibile: '{percorso}'.")

    # Path locale con slash iniziale (legacy)
    if percorso.startswith("/"):
        stripped = percorso.lstrip("/")
        if stripped.startswith(f"{_LOCAL_UPLOADS_DIR}/"):
            return stripped
        return f"{_LOCAL_UPLOADS_DIR}/{stripped}"

    # Path interno corretto (forma attuale)
    if percorso.startswith(f"{_LOCAL_UPLOADS_DIR}/"):
        return percorso

    # Fallback: prefissa uploads/
    return f"{_LOCAL_UPLOADS_DIR}/{percorso}"


def delete_file(percorso: str) -> None:
    """
    Elimina un file dato il percorso interno o URL legacy.
    Non lancia eccezioni se il file non viene trovato.

    Gestisce retrocompatibilità con:
    - URL pubblici Supabase ('https://...')
    - Path locali con slash iniziale ('/uploads/...')
    - Path interni nuovi ('uploads/...')
    """
    if not percorso:
        return

    try:
        internal_path = _resolve_internal_path(percorso)
    except ValueError:
        return  # path non valido — non fare nulla

    client = _get_supabase()
    if client:
        try:
            client.storage.from_(STORAGE_BUCKET).remove([internal_path])
        except Exception:
            pass
    else:
        # Filesystem locale
        base_dir = os.path.realpath(_LOCAL_UPLOADS_DIR)
        relative = internal_path.lstrip("/")
        if not relative.startswith(f"{_LOCAL_UPLOADS_DIR}/"):
            return
        filename_only = relative[len(f"{_LOCAL_UPLOADS_DIR}/"):]
        candidate = os.path.realpath(os.path.join(base_dir, filename_only))
        if not candidate.startswith(base_dir + os.sep):
            return  # path traversal — non fare nulla
        if os.path.exists(candidate):
            try:
                os.remove(candidate)
            except OSError:
                pass
