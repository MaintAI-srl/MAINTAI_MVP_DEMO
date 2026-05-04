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

from backend.core.rate_limiter import limiter as _limiter

try:
    from backend.api.routes.assets import router as assets_router
    from backend.api.routes.auth import router as auth_router
    from backend.api.routes.dashboard import router as dashboard_router
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
    from backend.api.routes.bulk_import import router as bulk_import_router
    from backend.api.routes.piano_manutenzione import router as piano_manutenzione_router
    from backend.api.routes.utenti import router as utenti_router
    from backend.api.routes.desktop_update import router as desktop_update_router
    from backend.api.routes.conditions import router as conditions_router
    from backend.api.routes.failure_engine import router as failure_engine_router
    from backend.core.config import init_backend
    from backend.core.exceptions import AppError, app_error_handler, generic_error_handler
    from backend.core.init_db import init_db
    from backend.core.logging_config import setup_logging
    from backend.services.email_poller import check_all_mailboxes
    from backend.services.retention_service import run_retention_job
    from backend.services.auto_ticket_service import run_auto_ticket_job
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
    # produzione web
    "https://maintai.vercel.app",
    "https://maintai-frontend.vercel.app",
    "https://maintaiv3.vercel.app",
    "https://maintai-mvp-demo.vercel.app",
    # Tauri Desktop — WebView2 (Windows) usa http://tauri.localhost
    # WebView (macOS/Linux) usa tauri://localhost
    "http://tauri.localhost",
    "tauri://localhost",
    "https://tauri.localhost",
]


def _load_origins() -> list[str]:
    """Legge CORS_ORIGINS dal .env (comma-separated), aggiunge sempre gli origin di produzione."""
    raw = os.getenv("CORS_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()] if raw.strip() else []
    # Merge con i default (produzione inclusa) senza duplicati
    for o in _DEFAULT_ORIGINS:
        if o not in origins:
            origins.append(o)
    return origins


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
        # attivita_manutenzione — codice univoco per piani creati manualmente
        ("attivita_manutenzione", "codice",            "ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}codice VARCHAR"),
        ("attivita_manutenzione", "nome",              "ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}nome VARCHAR"),
        # ticket — audit chiusura
        ("ticket", "closed_by",                        "ALTER TABLE ticket ADD COLUMN {ifne}closed_by VARCHAR"),
        # ticket — note eliminazione
        ("ticket", "eliminazione_note",                "ALTER TABLE ticket ADD COLUMN {ifne}eliminazione_note TEXT"),
        # ticket — manual plan
        ("ticket", "is_manual_plan",                   "ALTER TABLE ticket ADD COLUMN {ifne}is_manual_plan BOOLEAN DEFAULT FALSE"),
        # ticket — competenza richiesta esplicita (v3.1.3)
        ("ticket", "competenza_richiesta",             "ALTER TABLE ticket ADD COLUMN {ifne}competenza_richiesta VARCHAR"),
        # ticket — piani_manutenzione
        ("ticket", "piano_manutenzione_id",            "ALTER TABLE ticket ADD COLUMN {ifne}piano_manutenzione_id INTEGER"),
        ("ticket", "origine_piano",                    "ALTER TABLE ticket ADD COLUMN {ifne}origine_piano VARCHAR"),
        # ticket — origine unificata (v2.5.0)
        ("ticket", "origin_type",                      "ALTER TABLE ticket ADD COLUMN {ifne}origin_type VARCHAR"),
        # attivita_manutenzione — campi unificazione Task/Piano (v2.5.0)
        ("attivita_manutenzione", "generation_mode",         "ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}generation_mode VARCHAR DEFAULT 'manual'"),
        ("attivita_manutenzione", "generate_days_before_due","ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}generate_days_before_due INTEGER DEFAULT 7"),
        ("attivita_manutenzione", "task_stato",              "ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}task_stato VARCHAR DEFAULT 'active'"),
        ("attivita_manutenzione", "source_type",             "ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}source_type VARCHAR"),
        ("attivita_manutenzione", "last_generated_at",       "ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}last_generated_at TIMESTAMP"),
        ("attivita_manutenzione", "next_due_at",             "ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}next_due_at TIMESTAMP"),
        # attivita_manutenzione — manutenzione su condizione (v3.2)
        ("attivita_manutenzione", "trigger_mode",            "ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}trigger_mode VARCHAR DEFAULT 'calendar'"),
        ("attivita_manutenzione", "condition_metric",        "ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}condition_metric VARCHAR"),
        ("attivita_manutenzione", "condition_threshold_hours","ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}condition_threshold_hours FLOAT"),
        ("attivita_manutenzione", "condition_last_done_hours","ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}condition_last_done_hours FLOAT"),
        # attivita_manutenzione — collegamento strutturale al piano (v2.5.1)
        ("attivita_manutenzione", "piano_id",                "ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}piano_id INTEGER"),
        ("attivita_manutenzione", "is_repeatable",           "ALTER TABLE attivita_manutenzione ADD COLUMN {ifne}is_repeatable BOOLEAN DEFAULT TRUE"),
        # failure_modes — FIE knowledge base (v3.2.0)
        ("failure_modes", "mtbf_hours",   "ALTER TABLE failure_modes ADD COLUMN {ifne}mtbf_hours FLOAT"),
        ("failure_modes", "peso_appreso", "ALTER TABLE failure_modes ADD COLUMN {ifne}peso_appreso FLOAT DEFAULT 1.0"),
        ("failure_modes", "source",       "ALTER TABLE failure_modes ADD COLUMN {ifne}source VARCHAR DEFAULT 'seed'"),
        ("failure_modes", "is_global",    "ALTER TABLE failure_modes ADD COLUMN {ifne}is_global BOOLEAN DEFAULT TRUE"),
        # failure_analysis — spiegazione AI (v3.2.0)
        ("failure_analysis", "ai_explanation", "ALTER TABLE failure_analysis ADD COLUMN {ifne}ai_explanation TEXT"),
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

    # planner_feedback — tabella feedback di esecuzione (v3.1.3)
    pf_pg = """
        CREATE TABLE IF NOT EXISTS planner_feedback (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER REFERENCES tenants(id),
            ticket_id INTEGER NOT NULL REFERENCES ticket(id),
            generated_plan_id INTEGER REFERENCES generated_plans(id),
            planned_date DATE,
            planned_technician_id INTEGER,
            estimated_duration_hours FLOAT,
            confidence_score_at_plan FLOAT,
            actual_start TIMESTAMP,
            actual_finish TIMESTAMP,
            actual_duration_hours FLOAT,
            actual_technician_id INTEGER,
            execution_outcome VARCHAR DEFAULT 'completed',
            duration_delta_hours FLOAT,
            date_delta_days INTEGER,
            technician_changed BOOLEAN DEFAULT FALSE,
            user_rating INTEGER,
            user_notes TEXT,
            ticket_tipo VARCHAR,
            asset_id INTEGER,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """
    pf_sqlite = """
        CREATE TABLE IF NOT EXISTS planner_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER REFERENCES tenants(id),
            ticket_id INTEGER NOT NULL REFERENCES ticket(id),
            generated_plan_id INTEGER REFERENCES generated_plans(id),
            planned_date DATE,
            planned_technician_id INTEGER,
            estimated_duration_hours FLOAT,
            confidence_score_at_plan FLOAT,
            actual_start DATETIME,
            actual_finish DATETIME,
            actual_duration_hours FLOAT,
            actual_technician_id INTEGER,
            execution_outcome VARCHAR DEFAULT 'completed',
            duration_delta_hours FLOAT,
            date_delta_days INTEGER,
            technician_changed BOOLEAN DEFAULT FALSE,
            user_rating INTEGER,
            user_notes TEXT,
            ticket_tipo VARCHAR,
            asset_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """

    acr_pg = """
        CREATE TABLE IF NOT EXISTS asset_condition_readings (
            id SERIAL PRIMARY KEY,
            asset_id INTEGER NOT NULL REFERENCES asset(id),
            tenant_id INTEGER REFERENCES tenants(id),
            metric VARCHAR NOT NULL DEFAULT 'running_hours',
            value FLOAT NOT NULL,
            recorded_at TIMESTAMP NOT NULL DEFAULT NOW(),
            note TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """
    acr_sqlite = """
        CREATE TABLE IF NOT EXISTS asset_condition_readings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id INTEGER NOT NULL REFERENCES asset(id),
            tenant_id INTEGER REFERENCES tenants(id),
            metric VARCHAR NOT NULL DEFAULT 'running_hours',
            value FLOAT NOT NULL,
            recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

        # piani_assets_association — tabella many-to-many (commentata nel migration Alembic)
        paa_pg = """
            CREATE TABLE IF NOT EXISTS piani_assets_association (
                piano_id INTEGER NOT NULL REFERENCES piani_manutenzione(id) ON DELETE CASCADE,
                asset_id INTEGER NOT NULL REFERENCES asset(id) ON DELETE CASCADE,
                PRIMARY KEY (piano_id, asset_id)
            )
        """
        paa_sqlite = """
            CREATE TABLE IF NOT EXISTS piani_assets_association (
                piano_id INTEGER NOT NULL REFERENCES piani_manutenzione(id),
                asset_id INTEGER NOT NULL REFERENCES asset(id),
                PRIMARY KEY (piano_id, asset_id)
            )
        """

        # failure_modes — knowledge base FMECA (FIE v3.2.0)
        fm_pg = """
            CREATE TABLE IF NOT EXISTS failure_modes (
                id SERIAL PRIMARY KEY,
                asset_type VARCHAR NOT NULL,
                component VARCHAR NOT NULL,
                failure_mode VARCHAR NOT NULL,
                failure_cause VARCHAR,
                failure_effect VARCHAR,
                detection_method VARCHAR,
                recommended_action VARCHAR,
                mtbf_hours FLOAT,
                severity INTEGER NOT NULL DEFAULT 5,
                occurrence INTEGER NOT NULL DEFAULT 5,
                detectability INTEGER NOT NULL DEFAULT 5,
                rpn INTEGER NOT NULL DEFAULT 125,
                peso_appreso FLOAT DEFAULT 1.0,
                source VARCHAR DEFAULT 'seed',
                is_global BOOLEAN DEFAULT TRUE,
                tenant_id INTEGER REFERENCES tenants(id),
                created_at TIMESTAMP DEFAULT NOW()
            )
        """
        fm_sqlite = """
            CREATE TABLE IF NOT EXISTS failure_modes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                asset_type VARCHAR NOT NULL,
                component VARCHAR NOT NULL,
                failure_mode VARCHAR NOT NULL,
                failure_cause VARCHAR,
                failure_effect VARCHAR,
                detection_method VARCHAR,
                recommended_action VARCHAR,
                mtbf_hours FLOAT,
                severity INTEGER NOT NULL DEFAULT 5,
                occurrence INTEGER NOT NULL DEFAULT 5,
                detectability INTEGER NOT NULL DEFAULT 5,
                rpn INTEGER NOT NULL DEFAULT 125,
                peso_appreso FLOAT DEFAULT 1.0,
                source VARCHAR DEFAULT 'seed',
                is_global BOOLEAN DEFAULT TRUE,
                tenant_id INTEGER REFERENCES tenants(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """

        # failure_analysis — risultati FIE per ticket (FIE v3.2.0)
        fa_pg = """
            CREATE TABLE IF NOT EXISTS failure_analysis (
                id SERIAL PRIMARY KEY,
                ticket_id INTEGER NOT NULL REFERENCES ticket(id),
                failure_mode_id INTEGER NOT NULL REFERENCES failure_modes(id),
                probability_score FLOAT NOT NULL,
                rpn_weighted FLOAT NOT NULL,
                ai_explanation TEXT,
                selected BOOLEAN DEFAULT FALSE,
                tenant_id INTEGER REFERENCES tenants(id),
                created_at TIMESTAMP DEFAULT NOW()
            )
        """
        fa_sqlite = """
            CREATE TABLE IF NOT EXISTS failure_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL REFERENCES ticket(id),
                failure_mode_id INTEGER NOT NULL REFERENCES failure_modes(id),
                probability_score FLOAT NOT NULL,
                rpn_weighted FLOAT NOT NULL,
                ai_explanation TEXT,
                selected BOOLEAN DEFAULT FALSE,
                tenant_id INTEGER REFERENCES tenants(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """

        # diagnostic_learning — storico conferme tecnico (FIE v3.2.0)
        dl_pg = """
            CREATE TABLE IF NOT EXISTS diagnostic_learning (
                id SERIAL PRIMARY KEY,
                ticket_id INTEGER NOT NULL REFERENCES ticket(id),
                symptoms TEXT NOT NULL,
                diagnosed_failure_mode_id INTEGER REFERENCES failure_modes(id),
                real_cause TEXT NOT NULL,
                action_taken TEXT NOT NULL,
                resolution_time_minutes INTEGER,
                success BOOLEAN DEFAULT TRUE,
                tenant_id INTEGER REFERENCES tenants(id),
                created_at TIMESTAMP DEFAULT NOW()
            )
        """
        dl_sqlite = """
            CREATE TABLE IF NOT EXISTS diagnostic_learning (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticket_id INTEGER NOT NULL REFERENCES ticket(id),
                symptoms TEXT NOT NULL,
                diagnosed_failure_mode_id INTEGER REFERENCES failure_modes(id),
                real_cause TEXT NOT NULL,
                action_taken TEXT NOT NULL,
                resolution_time_minutes INTEGER,
                success BOOLEAN DEFAULT TRUE,
                tenant_id INTEGER REFERENCES tenants(id),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """

        # 1. Crea le tabelle complete se non esistono
        _exec_ddl(sl_pg if pg else sl_sqlite, "system_logs CREATE")
        _exec_ddl(gp_pg if pg else gp_sqlite, "generated_plans CREATE")
        _exec_ddl(paa_pg if pg else paa_sqlite, "piani_assets_association CREATE")
        _exec_ddl(pf_pg if pg else pf_sqlite, "planner_feedback CREATE")
        _exec_ddl(acr_pg if pg else acr_sqlite, "asset_condition_readings CREATE")
        _exec_ddl(fm_pg if pg else fm_sqlite, "failure_modes CREATE")
        _exec_ddl(fa_pg if pg else fa_sqlite, "failure_analysis CREATE")
        _exec_ddl(dl_pg if pg else dl_sqlite, "diagnostic_learning CREATE")

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
        _run_alembic_upgrade()  
        print("✅ migrations checked")
        init_db()               
        print("✅ main db initialized")
        _ensure_columns()       
        print("✅ ensure_columns (post-init) done")
    except Exception as e:
        print(f"❌ CRASH DURING STARTUP: {str(e)}")
        traceback.print_exc()
        raise e

    # Avvio tasks in background
    poller_task = asyncio.create_task(email_poller_task())
    retention_task = asyncio.create_task(run_retention_job())
    auto_ticket_task = asyncio.create_task(run_auto_ticket_job())
    print("✅ background tasks started")

    yield

    # Pulizia
    print("🛑 APP LIFESPAN ENDING...")
    poller_task.cancel()
    retention_task.cancel()
    auto_ticket_task.cancel()

app = FastAPI(title="MaintAI Backend", lifespan=lifespan)

app.add_exception_handler(AppError, app_error_handler)
app.add_exception_handler(Exception, generic_error_handler)

# Rate limiting — obbligatorio
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
app.state.limiter = _limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

_origins = _load_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Tenant-Id", "X-Requested-With", "Accept", "Origin"],
)

from fastapi.responses import JSONResponse
@app.middleware("http")
async def csrf_origin_check(request: Request, call_next):
    """
    Anti-CSRF Middleware (Fix per SameSite=None):
    Verifica che l'Origin (o il Referer) delle richieste State-Changing coincida con la whitelist.
    Adotta un approccio Fail-Closed: se mancano gli header, blocca la richiesta mutante.
    """
    if request.method in ("POST", "PUT", "DELETE", "PATCH"):
        # Bearer token = client nativo (Tauri desktop) o API diretta.
        # Le richieste con Authorization header non possono essere forgiate da form cross-site.
        if request.headers.get("authorization", "").startswith("Bearer "):
            return await call_next(request)

        origin = request.headers.get("origin")
        referer = request.headers.get("referer")

        # 1. Verifica Origin (header primario per browser moderni)
        if origin:
            if origin not in _origins:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Richiesta bloccata: Origin mismatch (Possibile CSRF)."}
                )
        # 2. Fallback su Referer (per browser o casi edge in cui Origin manca)
        elif referer:
            # Estrae l'origine dal referer (es. http://localhost:3000/path -> http://localhost:3000)
            from urllib.parse import urlparse
            ref_origin = f"{urlparse(referer).scheme}://{urlparse(referer).netloc}"
            if ref_origin not in _origins:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Richiesta bloccata: Referer mismatch (Possibile CSRF)."}
                )
        # 3. Fail-Closed: Se mancano entrambi, blocca (previene bypass tramite omissione header)
        else:
            return JSONResponse(
                status_code=403,
                content={"detail": "Richiesta bloccata: Origin/Referer mancanti (Obbligatori per azioni mutanti)."}
            )
            
    return await call_next(request)


# ── Routers legacy (senza prefisso) — mantenuti per retrocompatibilità frontend ──
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(dashboard_router)
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
app.include_router(bulk_import_router)
app.include_router(piano_manutenzione_router)
app.include_router(utenti_router)
app.include_router(desktop_update_router)
app.include_router(conditions_router)
app.include_router(failure_engine_router)

# ── Routers v1 (prefisso /v1) — per futura migrazione del frontend ──
# Il frontend può gradualmente migrare da /endpoint a /v1/endpoint.
# Entrambi i path restano attivi finché la migrazione non è completa.
_V1_ROUTERS = [
    auth_router, dashboard_router, assets_router, tecnici_router, tickets_router,
    scadenze_router, manuali_router, diagnostic_router, piani_router, impianti_router,
    siti_router, problem_analysis_router, planning_router, piano_manutenzione_router,
    conditions_router,
]
for _r in _V1_ROUTERS:
    app.include_router(_r, prefix="/v1")

# Mount cartella statica solo in locale (in cloud i file sono su Supabase Storage)
if not os.getenv("SUPABASE_URL"):
    os.makedirs("uploads", exist_ok=True)
    app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
