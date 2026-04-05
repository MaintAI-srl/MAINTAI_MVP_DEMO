from typing import Generator
from sqlalchemy.orm import Session
from backend.core.database import SessionLocal


def get_db() -> Generator[Session, None, None]:
    """Fornisce una sessione database verso il DB principale."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
