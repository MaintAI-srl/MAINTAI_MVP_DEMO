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
from sqlalchemy import event
from sqlalchemy.orm import with_loader_criteria


class Base(DeclarativeBase):
    pass

# ContextVar per conservare l'id del tenant valido nella request corrente.
# Nessun valore di default, ignorato se None o non settato.
current_tenant_id = contextvars.ContextVar("current_tenant_id", default=None)

# Sessione SQLAlchemy della request corrente. I servizi trasversali (es. logger
# persistente) la usano solo per ricavare lo stesso bind/engine della request.
current_db_session = contextvars.ContextVar("current_db_session", default=None)

# Cache lazy dei modelli con colonna tenant_id (popolata al primo uso, quando i
# mapper sono già registrati — modelli.py importa questo modulo, quindi la
# registry è vuota all'import di database.py).
_tenant_scoped_models: list | None = None


def _get_tenant_scoped_models() -> list:
    global _tenant_scoped_models
    if _tenant_scoped_models is None:
        _tenant_scoped_models = [
            m.class_ for m in Base.registry.mappers if hasattr(m.class_, "tenant_id")
        ]
    return _tenant_scoped_models

@event.listens_for(SessionLocal, "do_orm_execute")
def _tenant_filter_do_orm_execute(execute_state):
    """Filtro tenant automatico (difesa in profondità).

    Si attiva SOLO quando `current_tenant_id` è valorizzato nel medesimo thread
    dell'esecuzione (job in background, script, test). Nel flusso request sincrono
    di FastAPI il contextvar resta None (le dependency girano nel threadpool e il
    valore non si propaga all'handler), quindi qui non viene aggiunto alcun
    predicato: l'isolamento resta garantito dal filtro esplicito per-query. Il
    listener è quindi un no-op sul percorso API e non introduce overhead.

    NB: si applica un criterio per singolo modello tenant-scoped con espressione
    diretta `model.tenant_id == tenant_id` (`tenant_id` resta un bound param che
    varia per esecuzione). Un unico `with_loader_criteria(Base, lambda ...)` con
    `hasattr` non è cacheable, e forzare `track_closure_variables=False` farebbe
    "sanguinare" il valore di un tenant nella cache dello statement (verificato).
    """
    tenant_id = current_tenant_id.get()
    if tenant_id is None:
        return
    if (
        execute_state.is_select
        and not execute_state.is_column_load
        and not execute_state.is_relationship_load
    ):
        execute_state.statement = execute_state.statement.options(
            *[
                with_loader_criteria(
                    model,
                    model.tenant_id == tenant_id,
                    include_aliases=True,
                    propagate_to_loaders=True,
                )
                for model in _get_tenant_scoped_models()
            ]
        )

