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

# Argomenti extra per la connessione:
# - SQLite richiede check_same_thread=False
# - PostgreSQL: connect_timeout evita che un connect appeso stalli lo startup 30-60s
#   (utile col cold start del pooler Supabase / Render free tier)
connect_args = (
    {"check_same_thread": False}
    if DATABASE_URL.startswith("sqlite")
    else {"connect_timeout": 10}
)

# Pool parameters: ottimizzati per PostgreSQL su Render (concorrenza + stabilità)
# SQLite usa StaticPool implicito → i parametri pool sono ignorati
_pool_kwargs: dict = {}
if not DATABASE_URL.startswith("sqlite"):
    _pool_kwargs = {
        "pool_size": 5,
        "max_overflow": 10,
        "pool_pre_ping": True,   # verifica connessioni stale prima dell'uso
        "pool_recycle": 1800,    # ricicla connessioni ogni 30 min (evita timeout PostgreSQL)
    }

engine = create_engine(DATABASE_URL, connect_args=connect_args, **_pool_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

import contextvars
from sqlalchemy import event, and_
from sqlalchemy.orm import DeclarativeBase, sessionmaker

class Base(DeclarativeBase):
    pass

# ContextVar per conservare l'id del tenant valido nella request corrente.
# Nessun valore di default, ignorato se None o non settato.
current_tenant_id = contextvars.ContextVar("current_tenant_id", default=None)

# Sessione SQLAlchemy della request corrente. I servizi trasversali (es. logger
# persistente) la usano solo per ricavare lo stesso bind/engine della request.
current_db_session = contextvars.ContextVar("current_db_session", default=None)

from sqlalchemy.orm import with_loader_criteria

@event.listens_for(SessionLocal, "do_orm_execute")
def _tenant_filter_do_orm_execute(execute_state):
    tenant_id = current_tenant_id.get()
    # Se il tenant_id è esplicito nel contesto (es. utente non superadmin)
    if tenant_id is not None:
        # Se è una select (anche join o subquery), inject del filtro automatico
        if execute_state.is_select and not execute_state.is_column_stat:
            execute_state.statement = execute_state.statement.options(
                with_loader_criteria(
                    Base,
                    lambda cls: cls.tenant_id == tenant_id if hasattr(cls, "tenant_id") else cls.id == cls.id,
                    include_aliases=True,
                    propagate_to_loaders=True
                )
            )

