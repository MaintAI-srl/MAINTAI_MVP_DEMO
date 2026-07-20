"""Reset password di un utente direttamente sul DB puntato da DATABASE_URL.

Uso (es. dalla Shell del servizio Render, dove DATABASE_URL è già configurata):

    RESET_USERNAME=admin RESET_PASSWORD='NuovaPasswordSicura' \
        python -m backend.scripts.reset_user_password

- RESET_USERNAME: utente da resettare (default: admin)
- RESET_PASSWORD: nuova password (obbligatoria, min 8 caratteri, MAI come
  argomento CLI per non finire nella history della shell)

Oltre all'hash bcrypt viene incrementato token_version: le sessioni JWT
esistenti dell'utente vengono invalidate.
"""
import os
import sys

from backend.core.database import SessionLocal
from backend.core.security import get_password_hash
from backend.db.modelli import Utente


def main() -> int:
    username = (os.getenv("RESET_USERNAME") or "admin").strip()
    password = os.getenv("RESET_PASSWORD") or ""
    if len(password) < 8:
        print("ERRORE: impostare RESET_PASSWORD (minimo 8 caratteri).", file=sys.stderr)
        return 1

    with SessionLocal() as db:
        user = db.query(Utente).filter(Utente.username == username).first()
        if not user:
            print(f"ERRORE: utente '{username}' non trovato.", file=sys.stderr)
            return 1
        user.password_hash = get_password_hash(password)
        user.token_version = (user.token_version or 1) + 1
        db.commit()
        print(f"OK: password di '{username}' aggiornata; sessioni esistenti invalidate.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
