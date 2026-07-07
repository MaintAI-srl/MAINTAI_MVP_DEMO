from typing import Generator
from sqlalchemy.orm import Session
from backend.core.database import SessionLocal, current_db_session


def get_db() -> Generator[Session, None, None]:
    """Fornisce una sessione database verso il DB principale.

    NB: niente `ContextVar.reset(token)` qui. FastAPI esegue setup e teardown
    delle dependency sincrone con yield in due chiamate `to_thread.run_sync`
    separate, ognuna con un `copy_context()` distinto: il token creato nel
    contesto del setup non è resettabile nel contesto del teardown e solleva
    `ValueError: Token was created in a different Context`, trasformando in
    500 richieste altrimenti riuscite (in modo intermittente, dipende dal
    timing di invio della risposta). `set(None)` è idempotente e sicuro in
    qualunque contesto.
    """
    db = SessionLocal()
    current_db_session.set(db)
    try:
        yield db
    finally:
        current_db_session.set(None)
        db.close()
