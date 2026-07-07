from typing import Generator
from sqlalchemy.orm import Session
from backend.core.database import SessionLocal, current_db_session


def get_db() -> Generator[Session, None, None]:
    """Fornisce una sessione database verso il DB principale."""
    db = SessionLocal()
    token = current_db_session.set(db)
    try:
        yield db
    finally:
        current_db_session.reset(token)
        db.close()
