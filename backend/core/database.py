import os
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

# Carica .env PRIMA di leggere DATABASE_URL, indipendente dall'ordine di import
_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
if _ENV_PATH.exists():
    try:
        from dotenv import load_dotenv
        load_dotenv(_ENV_PATH, override=False)  # override=False: OS env vars hanno precedenza
    except ImportError:
        pass  # python-dotenv non installato → ok in produzione (vars da OS)

# Root del progetto (3 livelli su da backend/core/database.py)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_SQLITE_DEFAULT = f"sqlite:///{_PROJECT_ROOT / 'maintai.db'}"

# In cloud imposta DATABASE_URL come variabile d'ambiente (PostgreSQL Render)
# In locale usa SQLite con path assoluto
DATABASE_URL = os.getenv("DATABASE_URL", _SQLITE_DEFAULT)

# Argomenti extra per la connessione (SQLite richiede check_same_thread=False)
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

class Base(DeclarativeBase):
    pass
