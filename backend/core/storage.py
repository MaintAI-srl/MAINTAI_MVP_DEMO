"""
Astrazione per il salvataggio dei file.

- In locale (SUPABASE_URL non configurata): salva in uploads/ e restituisce /uploads/<filename>
- In cloud (SUPABASE_URL configurata): carica su Supabase Storage e restituisce URL pubblico
"""

import os

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
STORAGE_BUCKET = os.getenv("SUPABASE_BUCKET", "maintai-uploads")

_client = None


def _get_supabase():
    global _client
    if _client is None and SUPABASE_URL and SUPABASE_SERVICE_KEY:
        from supabase import create_client
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client


def save_file(content: bytes, filename: str) -> str:
    """
    Salva il file e restituisce l'URL/percorso per accedervi.
    In cloud: URL pubblico Supabase Storage.
    In locale: percorso relativo /uploads/<filename>.
    """
    client = _get_supabase()
    if client:
        path = f"uploads/{filename}"
        client.storage.from_(STORAGE_BUCKET).upload(
            path, content, {"content-type": "application/octet-stream"}
        )
        return client.storage.from_(STORAGE_BUCKET).get_public_url(path)
    else:
        os.makedirs("uploads", exist_ok=True)
        filepath = os.path.join("uploads", filename)
        with open(filepath, "wb") as f:
            f.write(content)
        return f"/uploads/{filename}"


def delete_file(percorso: str) -> None:
    """Elimina un file dato il percorso/URL. Non lancia eccezioni se non trovato."""
    client = _get_supabase()
    if client and percorso.startswith("http"):
        # Estrai il path relativo dall'URL Supabase
        marker = f"/object/public/{STORAGE_BUCKET}/"
        if marker in percorso:
            path = percorso.split(marker, 1)[1]
            try:
                client.storage.from_(STORAGE_BUCKET).remove([path])
            except Exception:
                pass
    elif percorso.startswith("/uploads/"):
        local_path = percorso.lstrip("/")
        if os.path.exists(local_path):
            os.remove(local_path)
