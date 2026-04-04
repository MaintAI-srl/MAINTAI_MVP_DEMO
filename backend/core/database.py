import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# Root del progetto (3 livelli su da backend/core/database.py)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_SQLITE_DEFAULT = f"sqlite:///{_PROJECT_ROOT / 'maintai.db'}"

# In cloud imposta DATABASE_URL come variabile d'ambiente (PostgreSQL Supabase/Render)
# In locale usa SQLite con path assoluto → sempre lo stesso file indipendentemente da dove si lancia
DATABASE_URL = os.getenv("DATABASE_URL", _SQLITE_DEFAULT)

# Argomenti extra per la connessione (SQLite richiede check_same_thread=False)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass