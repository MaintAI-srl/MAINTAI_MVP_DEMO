import os
import sys
import asyncio
from contextlib import asynccontextmanager

# Forza UTF-8 su Windows per evitare UnicodeEncodeError con emoji nei log
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

try:
    from backend.api.routes.assets import router as assets_router
    from backend.api.routes.auth import router as auth_router
    from backend.api.routes.dashboard import router as dashboard_router
    from backend.api.routes.db_routes import router as db_router
    from backend.api.routes.diagnostic import router as diagnostic_router
    from backend.api.routes.health import router as health_router
    from backend.api.routes.impianti import router as impianti_router
    from backend.api.routes.siti import router as siti_router
    from backend.api.routes.manuali import router as manuali_router
    from backend.api.routes.piani import router as piani_router
    from backend.api.routes.problem_analysis import router as problem_analysis_router
    from backend.api.routes.tenants import router as tenants_router
    from backend.api.routes.scheduler import router as scheduler_router
    from backend.api.routes.tecnici import router as tecnici_router
    from backend.api.routes.tickets import router as tickets_router
    from backend.api.routes.scadenze import router as scadenze_router
    from backend.api.routes.logs import router as logs_router
    from backend.api.routes.email_config import router as email_config_router
    from backend.api.routes.demo import router as demo_router
    from backend.api.routes.planning import router as planning_router
    from backend.core.config import init_backend
    from backend.core.exceptions import AppError, app_error_handler, generic_error_handler
    from backend.core.init_db import init_db
    from backend.core.logging_config import setup_logging
    from backend.services.email_poller import check_all_mailboxes
except ImportError as e:
    print(f"❌ CRITICAL IMPORT ERROR: {e}")
    import traceback
    traceback.print_exc()
    raise e

async def email_poller_task():
    """Task in background che preleva le email IMAP per generare i ticket ogni 5 minuti."""
    while True:
        try:
            # Eseguiamo la funzione in un thread per non bloccare l'event loop di FastAPI, dato che imap-tools è sincrono.
            await asyncio.to_thread(check_all_mailboxes)
        except Exception as e:
            print(f"Errore generale nel task email poller: {e}")
        await asyncio.sleep(300) # Polling ogni 5 minuti


_DEFAULT_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://192.168.1.222:3000",
    "http://192.168.1.222:3001",
]


def _load_origins() -> list[str]:
    """Legge CORS_ORIGINS dal .env (comma-separated), con fallback ai default dev."""
    raw = os.getenv("CORS_ORIGINS", "")
    if raw.strip():
        return [o.strip() for o in raw.split(",") if o.strip()]
    return _DEFAULT_ORIGINS


def _run_alembic_upgrade() -> None:
    """Applica tutte le migrazioni Alembic pendenti (idempotente)."""
    import logging
    from alembic.config import Config
    from alembic import command

    logger = logging.getLogger(__name__)
    try:
        alembic_cfg = Config("alembic.ini")
        command.upgrade(alembic_cfg, "head")
        logger.info("Alembic: migrazioni aggiornate a head")
    except Exception as exc:
        logger.warning("Alembic upgrade fallito (continuo con init_db): %s", exc)

    # Fallback: aggiungi colonne mancanti via SQL diretto (idempotente)
    _ensure_columns()


def _ensure_columns() -> None:
    """Aggiunge colonne mancanti al DB — idempotente, compatibile SQLite e PostgreSQL."""
    import logging
    from sqlalchemy import create_engine, text
    from backend.core.database import DATABASE_URL

    logger = logging.getLogger(__name__)
    is_pg = DATABASE_URL.startswith("postgresql") or DATABASE_URL.startswith("postgres")

    # DDL statements idempotenti: ogni comando è autonomo
    # PostgreSQL supporta ADD COLUMN IF NOT EXISTS (v9.6+)
    # SQLite non supporta IF NOT EXISTS → usiamo try/except per colonna
    ddl_statements = [
        # asset — nuovi campi planning
        ("asset", "weather_constraint", "ALTER TABLE asset ADD COLUMN {ifne}weather_constraint VARCHAR"),
        ("asset", "fermo_on_schedule",  "ALTER TABLE asset ADD COLUMN {ifne}fermo_on_schedule BOOLEAN DEFAULT FALSE"),
        ("asset", "latitude",           "ALTER TABLE asset ADD COLUMN {ifne}latitude FLOAT"),
        ("asset", "longitude",          "ALTER TABLE asset ADD COLUMN {ifne}longitude FLOAT"),
    ]

    # generated_plans — tabella intera
    gp_pg = """
        CREATE TABLE IF NOT EXISTS generated_plans (
            id SERIAL PRIMARY KEY,
            created_at TIMESTAMP DEFAULT NOW(),
            status VARCHAR DEFAULT 'draft',
            horizon_days INTEGER DEFAULT 7,
            plan_json JSONB,
            confirmed_at TIMESTAMP,
            tenant_id INTEGER REFERENCES tenants(id)
        )
    """
    gp_sqlite = """
        CREATE TABLE IF NOT EXISTS generated_plans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            status VARCHAR DEFAULT 'draft',
            horizon_days INTEGER DEFAULT 7,
            plan_json TEXT,
            confirmed_at DATETIME,
            tenant_id INTEGER REFERENCES tenants(id)
        )
    """

    try:
        engine = create_engine(DATABASE_URL)
        ifne = "IF NOT EXISTS " if is_pg else ""

        with engine.begin() as conn:  # begin() → autocommit al termine del with
            for _table, col_name, tmpl in ddl_statements:
                sql = tmpl.format(ifne=ifne)
                try:
                    conn.execute(text(sql))
                    logger.info("_ensure_columns: OK — %s", sql.strip())
                except Exception as col_exc:
                    # Su SQLite "duplicate column name" è un errore — ignoralo
                    if "duplicate column" in str(col_exc).lower() or "already exists" in str(col_exc).lower():
                        logger.debug("_ensure_columns: colonna già presente (%s)", col_name)
                    else:
                        logger.warning("_ensure_columns: errore DDL su %s: %s", col_name, col_exc)

            conn.execute(text(gp_pg if is_pg else gp_sqlite))
            logger.info("_ensure_columns: generated_plans OK")

    except Exception as exc:
        logger.warning("_ensure_columns fallito (non bloccante): %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import traceback
    print("🚀 APP LIFESPAN STARTING...")
    try:
        setup_logging()
        print("✅ logging configured")
        init_backend()
        print("✅ backend initialized")
        _run_alembic_upgrade()  # applica migrazioni pendenti
        print("✅ migrations checked")
        init_db()               # crea tabelle mancanti + seed
        print("✅ main db initialized")
    except Exception as e:
        print(f"❌ CRASH DURING STARTUP: {str(e)}")
        traceback.print_exc()
        raise e

    # Avvio email poller in background
    poller_task = asyncio.create_task(email_poller_task())
    print("✅ background tasks started")
    
    yield
    
    # Pulizia
    print("🛑 APP LIFESPAN ENDING...")
    poller_task.cancel()

app = FastAPI(title="MaintAI Backend", lifespan=lifespan)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(Exception, generic_error_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(auth_router)
app.include_router(dashboard_router)
app.include_router(db_router)
app.include_router(assets_router)
app.include_router(tecnici_router)
app.include_router(tickets_router)
app.include_router(scadenze_router)
app.include_router(logs_router)
app.include_router(scheduler_router)
app.include_router(manuali_router)
app.include_router(diagnostic_router)
app.include_router(piani_router)
app.include_router(impianti_router)
app.include_router(siti_router)
app.include_router(problem_analysis_router)
app.include_router(tenants_router)
app.include_router(email_config_router)
app.include_router(demo_router)
app.include_router(planning_router)

# Mount cartella statica solo in locale (in cloud i file sono su Supabase Storage)
if not os.getenv("SUPABASE_URL"):
    os.makedirs("uploads", exist_ok=True)
    app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")