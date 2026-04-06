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

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.core.rate_limiter import limiter as _limiter, RATE_LIMITING_AVAILABLE as _RATE_LIMITING_AVAILABLE

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
    from backend.api.routes.planning import router as planning_router
    from backend.api.routes.ws_routes import router as ws_router
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
    """Task in background che preleva le email IMAP per generare i ticket ogni 5 minuti.

    In caso di errori consecutivi usa backoff esponenziale (max 30 min) per evitare
    di saturare il log e spammare server IMAP instabili.
    """
    _POLL_INTERVAL = 300  # 5 minuti nominali
    _MAX_BACKOFF = 1800   # 30 minuti al massimo
    consecutive_errors = 0
    while True:
        try:
            await asyncio.to_thread(check_all_mailboxes)
            consecutive_errors = 0
        except Exception as e:
            consecutive_errors += 1
            backoff = min(_POLL_INTERVAL * (2 ** (consecutive_errors - 1)), _MAX_BACKOFF)
            print(f"Errore email poller (tentativo #{consecutive_errors}): {e} — prossimo tentativo tra {backoff}s")
            await asyncio.sleep(backoff)
            continue
        await asyncio.sleep(_POLL_INTERVAL)


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
        # ticket — campi splitting AI (FASE 6)
        ("ticket", "parent_ticket_id",   "ALTER TABLE ticket ADD COLUMN {ifne}parent_ticket_id INTEGER"),
        ("ticket", "is_continuation",    "ALTER TABLE ticket ADD COLUMN {ifne}is_continuation BOOLEAN DEFAULT FALSE"),
        ("ticket", "planned_start_time", "ALTER TABLE ticket ADD COLUMN {ifne}planned_start_time TIME"),
        # generated_plans — storico piani
        ("generated_plans", "plan_number",             "ALTER TABLE generated_plans ADD COLUMN {ifne}plan_number INTEGER"),
        ("generated_plans", "confirmed_by",            "ALTER TABLE generated_plans ADD COLUMN {ifne}confirmed_by VARCHAR"),
        ("generated_plans", "deauthorized_at",         "ALTER TABLE generated_plans ADD COLUMN {ifne}deauthorized_at TIMESTAMP"),
        ("generated_plans", "deauthorized_by",         "ALTER TABLE generated_plans ADD COLUMN {ifne}deauthorized_by VARCHAR"),
        ("generated_plans", "deauthorization_reason",  "ALTER TABLE generated_plans ADD COLUMN {ifne}deauthorization_reason VARCHAR"),
        # scadenza: max planned_date dei workorder, calcolata alla conferma
        ("generated_plans", "scadenza",                "ALTER TABLE generated_plans ADD COLUMN {ifne}scadenza TIMESTAMP"),
        # tecnici_assenze — isolamento multi-tenant
        ("tecnici_assenze", "tenant_id",               "ALTER TABLE tecnici_assenze ADD COLUMN {ifne}tenant_id INTEGER"),
        # ticket — audit trail
        ("ticket", "created_by",                       "ALTER TABLE ticket ADD COLUMN {ifne}created_by VARCHAR"),
        # ticket — soft deletion
        ("ticket", "deleted_at",                       "ALTER TABLE ticket ADD COLUMN {ifne}deleted_at TIMESTAMP"),
        # ticket — multi-tecnico (numero tecnici richiesti, default 1)
        ("ticket", "tecnici_richiesti",                "ALTER TABLE ticket ADD COLUMN {ifne}tecnici_richiesti INTEGER DEFAULT 1"),
    ]

    # system_logs — tabella intera
    sl_pg = """
        CREATE TABLE IF NOT EXISTS system_logs (
            id SERIAL PRIMARY KEY,
            timestamp TIMESTAMP DEFAULT NOW(),
            level VARCHAR,
            module VARCHAR,
            message TEXT,
            extra_info TEXT,
            tenant_id INTEGER REFERENCES tenants(id)
        )
    """
    sl_sqlite = """
        CREATE TABLE IF NOT EXISTS system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
            level VARCHAR,
            module VARCHAR,
            message TEXT,
            extra_info TEXT,
            tenant_id INTEGER REFERENCES tenants(id)
        )
    """

    # generated_plans — tabella intera (con tutte le colonne incluse le nuove)
    gp_pg = """
        CREATE TABLE IF NOT EXISTS generated_plans (
            id SERIAL PRIMARY KEY,
            created_at TIMESTAMP DEFAULT NOW(),
            status VARCHAR DEFAULT 'draft',
            horizon_days INTEGER DEFAULT 7,
            plan_json JSONB,
            confirmed_at TIMESTAMP,
            tenant_id INTEGER REFERENCES tenants(id),
            plan_number INTEGER,
            confirmed_by VARCHAR,
            deauthorized_at TIMESTAMP,
            deauthorized_by VARCHAR,
            deauthorization_reason VARCHAR,
            scadenza TIMESTAMP
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
            tenant_id INTEGER REFERENCES tenants(id),
            plan_number INTEGER,
            confirmed_by VARCHAR,
            deauthorized_at DATETIME,
            deauthorized_by VARCHAR,
            deauthorization_reason VARCHAR,
            scadenza DATETIME
        )
    """

    def _apply_to(url: str, pg: bool) -> None:
        from sqlalchemy import create_engine, text
        ca = {"check_same_thread": False} if url.startswith("sqlite") else {}
        eng = create_engine(url, connect_args=ca)
        ifne = "IF NOT EXISTS " if pg else ""
        db_label = url.split("://")[0]

        # ── CRITICO: ogni DDL in transazione separata ──────────────────────────
        # Su PostgreSQL, un errore in una transazione mette il connection in stato
        # "aborted": tutti i DDL successivi nella stessa transazione vengono
        # ignorati silenziosamente. Usando una transazione per ogni statement
        # ogni DDL è indipendente e idempotente.

        def _exec_ddl(sql: str, label: str) -> None:
            try:
                with eng.begin() as conn:
                    conn.execute(text(sql))
                logger.info("_ensure_columns[%s]: OK %s", db_label, label)
            except Exception as exc:
                msg = str(exc).lower()
                if "already exists" in msg or "duplicate column" in msg or "duplicate object" in msg:
                    logger.debug("_ensure_columns[%s]: già presente %s", db_label, label)
                else:
                    logger.warning("_ensure_columns[%s] DDL %s: %s", db_label, label, exc)

        # 1. Crea le tabelle complete se non esistono
        _exec_ddl(sl_pg if pg else sl_sqlite, "system_logs CREATE")
        _exec_ddl(gp_pg if pg else gp_sqlite, "generated_plans CREATE")

        # 2. Aggiungi colonne mancanti (ogni ALTER nella propria transazione)
        for _table, col_name, tmpl in ddl_statements:
            _exec_ddl(tmpl.format(ifne=ifne), col_name)

    try:
        from backend.core.database import DATABASE_URL as MAIN_URL
        _apply_to(MAIN_URL, is_pg)
    except Exception as exc:
        logger.warning("_ensure_columns: import URL fallito: %s", exc)


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

# Rate limiting — attivo solo se slowapi è installato
if _RATE_LIMITING_AVAILABLE:
    from slowapi.errors import RateLimitExceeded
    from slowapi import _rate_limit_exceeded_handler
    app.state.limiter = _limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_origins = _load_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers legacy (senza prefisso) — mantenuti per retrocompatibilità frontend ──
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
app.include_router(planning_router)
app.include_router(ws_router)  # WebSocket real-time updates

# ── Routers v1 (prefisso /v1) — per futura migrazione del frontend ──
# Il frontend può gradualmente migrare da /endpoint a /v1/endpoint.
# Entrambi i path restano attivi finché la migrazione non è completa.
_V1_ROUTERS = [
    auth_router, dashboard_router, assets_router, tecnici_router, tickets_router,
    scadenze_router, manuali_router, diagnostic_router, piani_router, impianti_router,
    siti_router, problem_analysis_router, planning_router,
]
for _r in _V1_ROUTERS:
    app.include_router(_r, prefix="/v1")

# Mount cartella statica solo in locale (in cloud i file sono su Supabase Storage)
if not os.getenv("SUPABASE_URL"):
    os.makedirs("uploads", exist_ok=True)
    app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")