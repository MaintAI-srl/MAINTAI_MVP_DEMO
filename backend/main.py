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

from fastapi import Depends, FastAPI, HTTPException, Request
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
    from backend.api.routes.modules import router as modules_router
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
    from backend.api.routes.guide import router as guide_router
    from backend.api.routes.procedure import router as procedure_router
    from backend.api.routes.note_asset import router as note_asset_router
    from backend.api.routes.check_primo_livello import router as check_pl_router
    from backend.api.routes.attestati import router as attestati_router
    from backend.api.routes.report import router as report_router
    from backend.api.routes.emergency import router as emergency_router
    from backend.api.routes.control_center import router as control_center_router
    from backend.api.routes.asset_documenti import router as asset_documenti_router
    from backend.core.config import init_backend
    from backend.core.security import IS_PRODUCTION
    from backend.core.exceptions import AppError, app_error_handler, generic_error_handler
    from backend.core.init_db import init_db
    from backend.core.logging_config import setup_logging
    from backend.core.logger_db import db_warn
    from backend.core.modules import is_module_enabled, is_module_enabled_for_tenant
    from backend.core.security import decode_payload_leniently, resolve_tenant_id_leniently
    from backend.core.dependencies import get_db
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


# Origin sempre ammessi (produzione web + desktop Tauri)
_PROD_ORIGINS = [
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

# Origin di sviluppo locale — NON aggiunti in produzione (niente localhost/IP privati in allowlist)
_DEV_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://192.168.1.222:3000",
    "http://192.168.1.222:3001",
]

_PRIVATE_ORIGIN_HINTS = ("localhost", "127.0.0.1", "192.168.", "10.", "172.16.", "0.0.0.0")


def _load_origins() -> list[str]:
    """Legge CORS_ORIGINS dal .env (comma-separated). Aggiunge sempre gli origin di
    produzione; quelli di sviluppo solo fuori dalla produzione.

    Fail-closed: il middleware usa `allow_credentials=True`, quindi un wildcard `*`
    è sempre vietato (startup abort). In produzione anche gli origin locali/privati
    in CORS_ORIGINS bloccano lo startup — fanno eccezione solo gli origin Tauri
    (`tauri.localhost`) già presenti nell'allowlist di produzione."""
    raw = os.getenv("CORS_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip()] if raw.strip() else []

    if any(o == "*" or o.endswith("://*") for o in origins):
        raise RuntimeError(
            "CORS_ORIGINS contiene un wildcard '*': vietato con allow_credentials=True. "
            "Specificare gli origin in modo esplicito."
        )

    if IS_PRODUCTION:
        bad = [
            o for o in origins
            if o not in _PROD_ORIGINS and any(h in o for h in _PRIVATE_ORIGIN_HINTS)
        ]
        if bad:
            raise RuntimeError(
                f"CORS in produzione: origin locali/privati vietati in CORS_ORIGINS: {bad}. "
                "Rimuoverli dalla variabile d'ambiente prima del deploy."
            )

    defaults = _PROD_ORIGINS if IS_PRODUCTION else (_PROD_ORIGINS + _DEV_ORIGINS)
    for o in defaults:
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


def _is_database_auth_block(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "ecircuitbreaker" in msg
        or "authentication" in msg
        or "password authentication failed" in msg
        or "tenant or user not found" in msg
    )


def _is_database_capacity_block(exc: Exception) -> bool:
    msg = str(exc).lower()
    return (
        "emaxconnsession" in msg
        or "max clients reached" in msg
        or "too many connections" in msg
        or "remaining connection slots are reserved" in msg
    )


def _check_database_connection() -> bool:
    """Verifica la raggiungibilità del DB allo startup con retry a backoff esponenziale.

    Un fail-fast immediato è controproducente su Render: se il DB rifiuta l'auth
    (credenziali errate o circuit breaker del pooler Supabase, `ECIRCUITBREAKER`),
    il container crasha e viene riavviato subito, rilanciando altri tentativi di auth
    che tengono il circuit breaker sempre aperto (crash-loop). Un retry con backoff
    riduce il rate di tentativi e dà tempo al pooler di rientrare, senza nascondere
    un errore di configurazione persistente (dopo i retry rilancia comunque).
    """
    import logging
    import time
    from sqlalchemy import text
    from backend.core.database import engine, DATABASE_URL

    logger = logging.getLogger(__name__)
    backoffs = [2, 4, 8, 16, 32]  # secondi tra i tentativi (6 tentativi totali, ~62s max)
    last_exc: Exception | None = None

    for attempt in range(len(backoffs) + 1):
        try:
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            logger.info("Database raggiungibile (%s)", DATABASE_URL.split("://", 1)[0])
            return True
        except Exception as exc:
            last_exc = exc
            is_auth_failure = _is_database_auth_block(exc)
            is_capacity_failure = _is_database_capacity_block(exc)
            if is_auth_failure or is_capacity_failure:
                reason = "Autenticazione DB rifiutata" if is_auth_failure else "Pool DB saturo"
                hint = (
                    "Verifica DATABASE_URL su Render: con il pooler Supabase "
                    "(*.pooler.supabase.com) lo username deve essere "
                    "'postgres.<project-ref>' e la password quella del database."
                    if is_auth_failure
                    else
                    "Riduci DB_POOL_SIZE/DB_MAX_OVERFLOW o libera sessioni attive sul pooler Supabase."
                )
                logger.error(
                    "%s dal pooler/server (tentativo %d/%d). "
                    "%s Errore: %s",
                    reason, attempt + 1, len(backoffs) + 1, hint, exc,
                )
                logger.error(
                    "Startup in modalita degradata: interrompo i retry DB per evitare "
                    "crash-loop Render e ulteriori blocchi del pooler Supabase."
                )
                return False
            else:
                logger.warning(
                    "DB non raggiungibile (tentativo %d/%d): %s",
                    attempt + 1, len(backoffs) + 1, exc,
                )
            if attempt < len(backoffs):
                time.sleep(backoffs[attempt])

    logger.error(
        "Database non raggiungibile dopo %d tentativi durante lo startup. "
        "Verifica DATABASE_URL/credenziali sul provider prima di rilanciare il deploy: %s",
        len(backoffs) + 1, last_exc,
    )
    raise last_exc


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
        # ticket — tecnico di supporto opzionale (secondo operatore)
        ("ticket", "tecnico_supporto_id",              "ALTER TABLE ticket ADD COLUMN {ifne}tecnico_supporto_id INTEGER"),
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
        # ticket — dati ereditati gerarchia Asset→Impianto→Sito (denormalizzati)
        ("ticket", "sito_name",                        "ALTER TABLE ticket ADD COLUMN {ifne}sito_name VARCHAR"),
        ("ticket", "impianto_name",                    "ALTER TABLE ticket ADD COLUMN {ifne}impianto_name VARCHAR"),
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
        # M1.2 — Asset criticità A/B/C (prima era stringa generica)
        # (campo già esistente, solo assicuriamo il tipo corretto — nessuna ALTER necessaria)
        # M2.1 — Asset costo fermo (€/ora)
        ("asset", "costo_orario_fermo",       "ALTER TABLE asset ADD COLUMN {ifne}costo_orario_fermo FLOAT"),
        # M2.2 — Asset codice ricambio esterno
        ("asset", "codice_ricambio_esterno",   "ALTER TABLE asset ADD COLUMN {ifne}codice_ricambio_esterno VARCHAR"),
        # M2.2 — Ticket predisposizione ricambi
        ("ticket", "ricambio_note",            "ALTER TABLE ticket ADD COLUMN {ifne}ricambio_note TEXT"),
        ("ticket", "in_attesa_ricambio",       "ALTER TABLE ticket ADD COLUMN {ifne}in_attesa_ricambio BOOLEAN DEFAULT FALSE"),
        ("ticket", "ricambio_quantita",        "ALTER TABLE ticket ADD COLUMN {ifne}ricambio_quantita FLOAT"),
        # Ticket — note libere compilabili in creazione
        ("ticket", "note",                     "ALTER TABLE ticket ADD COLUMN {ifne}note TEXT"),
        # Ticket — firma di accettazione cliente (nome firmatario + data apposizione)
        ("ticket", "firma_nome",               "ALTER TABLE ticket ADD COLUMN {ifne}firma_nome VARCHAR"),
        ("ticket", "firma_data",               "ALTER TABLE ticket ADD COLUMN {ifne}firma_data TIMESTAMP"),
        # Ticket — ore uomo (change request 2026-07-05)
        ("ticket", "required_man_hours",           "ALTER TABLE ticket ADD COLUMN {ifne}required_man_hours FLOAT"),
        ("ticket", "man_hours_calculation_mode",   "ALTER TABLE ticket ADD COLUMN {ifne}man_hours_calculation_mode VARCHAR DEFAULT 'manual'"),
        # QR Code per asset (base64 PNG)
        ("asset", "qr_code_b64",               "ALTER TABLE asset ADD COLUMN {ifne}qr_code_b64 TEXT"),
        # Tecnico — telefono e sede per mappa emergenze
        ("tecnici", "telefono",                "ALTER TABLE tecnici ADD COLUMN {ifne}telefono VARCHAR"),
        ("tecnici", "sede_indirizzo",          "ALTER TABLE tecnici ADD COLUMN {ifne}sede_indirizzo VARCHAR"),
        # P1-05 — QR token scadenza e revoca (v3.3.1)
        # NB: TIMESTAMP e DEFAULT TRUE sono compatibili sia con SQLite sia con PostgreSQL.
        # (DATETIME e DEFAULT 1 sono sintassi SQLite e su Postgres fallivano:
        #  'type datetime does not exist' / 'boolean ... default expression is of type integer')
        ("check_primo_livello", "token_active",     "ALTER TABLE check_primo_livello ADD COLUMN {ifne}token_active BOOLEAN NOT NULL DEFAULT TRUE"),
        ("check_primo_livello", "token_expires_at", "ALTER TABLE check_primo_livello ADD COLUMN {ifne}token_expires_at TIMESTAMP"),
    ]

    # M4 / M5 — nuove tabelle (CREATE TABLE IF NOT EXISTS — idempotente)
    procedure_pg = """
        CREATE TABLE IF NOT EXISTS procedure (
            id SERIAL PRIMARY KEY,
            asset_id INTEGER NOT NULL REFERENCES asset(id),
            tenant_id INTEGER REFERENCES tenants(id),
            titolo VARCHAR NOT NULL,
            tipo VARCHAR DEFAULT 'ispezione',
            passi TEXT DEFAULT '[]',
            revisione INTEGER DEFAULT 1,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """
    procedure_sqlite = """
        CREATE TABLE IF NOT EXISTS procedure (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id INTEGER NOT NULL REFERENCES asset(id),
            tenant_id INTEGER REFERENCES tenants(id),
            titolo VARCHAR NOT NULL,
            tipo VARCHAR DEFAULT 'ispezione',
            passi TEXT DEFAULT '[]',
            revisione INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """
    note_asset_pg = """
        CREATE TABLE IF NOT EXISTS note_asset (
            id SERIAL PRIMARY KEY,
            asset_id INTEGER NOT NULL REFERENCES asset(id),
            tenant_id INTEGER REFERENCES tenants(id),
            testo TEXT NOT NULL,
            autore VARCHAR,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """
    note_asset_sqlite = """
        CREATE TABLE IF NOT EXISTS note_asset (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id INTEGER NOT NULL REFERENCES asset(id),
            tenant_id INTEGER REFERENCES tenants(id),
            testo TEXT NOT NULL,
            autore VARCHAR,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """
    check_pl_pg = """
        CREATE TABLE IF NOT EXISTS check_primo_livello (
            id SERIAL PRIMARY KEY,
            asset_id INTEGER NOT NULL REFERENCES asset(id),
            tenant_id INTEGER REFERENCES tenants(id),
            public_token VARCHAR NOT NULL UNIQUE,
            voci TEXT DEFAULT '[]',
            created_at TIMESTAMP DEFAULT NOW()
        )
    """
    check_pl_sqlite = """
        CREATE TABLE IF NOT EXISTS check_primo_livello (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            asset_id INTEGER NOT NULL REFERENCES asset(id),
            tenant_id INTEGER REFERENCES tenants(id),
            public_token VARCHAR NOT NULL UNIQUE,
            voci TEXT DEFAULT '[]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """
    attestati_pg = """
        CREATE TABLE IF NOT EXISTS attestati (
            id SERIAL PRIMARY KEY,
            tecnico_id INTEGER NOT NULL REFERENCES tecnici(id),
            tenant_id INTEGER REFERENCES tenants(id),
            tipo_corso VARCHAR NOT NULL,
            ente_certificatore VARCHAR,
            data_conseguimento DATE,
            data_scadenza DATE,
            note TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """
    attestati_sqlite = """
        CREATE TABLE IF NOT EXISTS attestati (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tecnico_id INTEGER NOT NULL REFERENCES tecnici(id),
            tenant_id INTEGER REFERENCES tenants(id),
            tipo_corso VARCHAR NOT NULL,
            ente_certificatore VARCHAR,
            data_conseguimento DATE,
            data_scadenza DATE,
            note TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """

    # tenant_module_config — override moduli per tenant
    tmc_pg = """
        CREATE TABLE IF NOT EXISTS tenant_module_config (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL UNIQUE REFERENCES tenants(id),
            enabled TEXT NOT NULL DEFAULT '[]',
            updated_at TIMESTAMP DEFAULT NOW()
        )
    """
    tmc_sqlite = """
        CREATE TABLE IF NOT EXISTS tenant_module_config (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id INTEGER NOT NULL UNIQUE REFERENCES tenants(id),
            enabled TEXT NOT NULL DEFAULT '[]',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """

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
        ca = {"check_same_thread": False} if url.startswith("sqlite") else {}
        pool_kwargs = (
            {}
            if url.startswith("sqlite")
            else {
                "pool_size": 1,
                "max_overflow": 0,
                "pool_timeout": 5,
                "pool_pre_ping": True,
            }
        )
        eng = create_engine(url, connect_args=ca, **pool_kwargs)
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

        # asset_documenti — documenti e esplosi allegati agli asset
        ad_pg = """
            CREATE TABLE IF NOT EXISTS asset_documenti (
                id SERIAL PRIMARY KEY,
                tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                asset_id INTEGER NOT NULL REFERENCES asset(id),
                nome VARCHAR NOT NULL,
                tipo VARCHAR NOT NULL,
                filename VARCHAR NOT NULL,
                content_type VARCHAR,
                file_data BYTEA NOT NULL,
                esploso_analisi TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        """
        ad_sqlite = """
            CREATE TABLE IF NOT EXISTS asset_documenti (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id INTEGER NOT NULL REFERENCES tenants(id),
                asset_id INTEGER NOT NULL REFERENCES asset(id),
                nome VARCHAR NOT NULL,
                tipo VARCHAR NOT NULL,
                filename VARCHAR NOT NULL,
                content_type VARCHAR,
                file_data BLOB NOT NULL,
                esploso_analisi TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """

        # 1. Crea le tabelle complete se non esistono
        _exec_ddl(sl_pg if pg else sl_sqlite, "system_logs CREATE")
        _exec_ddl(tmc_pg if pg else tmc_sqlite, "tenant_module_config CREATE")
        _exec_ddl(gp_pg if pg else gp_sqlite, "generated_plans CREATE")
        _exec_ddl(paa_pg if pg else paa_sqlite, "piani_assets_association CREATE")
        _exec_ddl(pf_pg if pg else pf_sqlite, "planner_feedback CREATE")
        _exec_ddl(acr_pg if pg else acr_sqlite, "asset_condition_readings CREATE")
        _exec_ddl(fm_pg if pg else fm_sqlite, "failure_modes CREATE")
        _exec_ddl(fa_pg if pg else fa_sqlite, "failure_analysis CREATE")
        _exec_ddl(dl_pg if pg else dl_sqlite, "diagnostic_learning CREATE")
        # M4 / M5 — nuove tabelle knowledge & compliance
        _exec_ddl(procedure_pg if pg else procedure_sqlite, "procedure CREATE")
        _exec_ddl(note_asset_pg if pg else note_asset_sqlite, "note_asset CREATE")
        _exec_ddl(check_pl_pg if pg else check_pl_sqlite, "check_primo_livello CREATE")
        _exec_ddl(attestati_pg if pg else attestati_sqlite, "attestati CREATE")
        _exec_ddl(ad_pg if pg else ad_sqlite, "asset_documenti CREATE")

        # 2. Aggiungi colonne mancanti (ogni ALTER nella propria transazione)
        for _table, col_name, tmpl in ddl_statements:
            _exec_ddl(tmpl.format(ifne=ifne), col_name)
        eng.dispose()

    try:
        from backend.core.database import DATABASE_URL as MAIN_URL
        _apply_to(MAIN_URL, is_pg)
    except Exception as exc:
        logger.warning("_ensure_columns: import URL fallito: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    import traceback
    db_ready = False
    print("🚀 APP LIFESPAN STARTING...")
    try:
        setup_logging()
        print("✅ logging configured")
        init_backend()
        print("✅ backend initialized")
        db_ready = _check_database_connection()
        print("✅ database connection checked")
        if db_ready:
            _run_alembic_upgrade()
        print("✅ migrations checked")
        if db_ready:
            init_db()
        print("✅ main db initialized")
        print("ensure_columns post-init skipped")
    except Exception as e:
        print(f"❌ CRASH DURING STARTUP: {str(e)}")
        traceback.print_exc()
        raise e

    # Avvio tasks in background coerente con i moduli attivi.
    background_tasks: list[asyncio.Task] = []
    if db_ready:
        background_tasks.append(asyncio.create_task(run_retention_job()))
    if db_ready and is_module_enabled("email_to_ticket"):
        background_tasks.append(asyncio.create_task(email_poller_task()))
    if db_ready and is_module_enabled("maintenance_plans") and is_module_enabled("tickets"):
        background_tasks.append(asyncio.create_task(run_auto_ticket_job()))
    if not db_ready:
        print("background tasks DB skipped in degraded startup")
    print(f"✅ background tasks started ({len(background_tasks)})")

    yield

    # Pulizia
    print("🛑 APP LIFESPAN ENDING...")
    for task in background_tasks:
        task.cancel()
    from backend.core.database import engine
    engine.dispose()

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
    allow_headers=["Content-Type", "Authorization", "X-Tenant-Id", "X-Requested-With", "Accept", "Origin", "X-Client"],
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
                db_warn("CSRF", f"Origin mismatch: {origin}", {"path": request.url.path, "method": request.method})
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
                db_warn("CSRF", f"Referer mismatch: {ref_origin}", {"path": request.url.path, "method": request.method, "referer": referer})
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Richiesta bloccata: Referer mismatch (Possibile CSRF)."}
                )
        # 3. Fail-Closed: Se mancano entrambi, blocca (previene bypass tramite omissione header)
        else:
            db_warn("CSRF", "Origin/Referer mancanti", {"path": request.url.path, "method": request.method})
            return JSONResponse(
                status_code=403,
                content={"detail": "Richiesta bloccata: Origin/Referer mancanti (Obbligatori per azioni mutanti)."}
            )
            
    return await call_next(request)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Header di sicurezza su tutte le risposte API (difesa in profondità).
    NB: niente X-Frame-Options qui — i file serviti dall'API possono essere mostrati
    in iframe dal frontend; il clickjacking dell'app UI è coperto dagli header del frontend."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    if IS_PRODUCTION:
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=63072000; includeSubDomains"
        )
    return response


# ── Router core: sempre disponibili ─────────────────────────────────────────
_CORE_ROUTERS = [
    health_router,
    auth_router,
    modules_router,
]
for _router in _CORE_ROUTERS:
    app.include_router(_router)


def _require_module_enabled(module_id: str):
    def _dependency(request: Request, db=Depends(get_db)):
        # Kill-switch globale (env + modules_state.json)
        if not is_module_enabled(module_id):
            raise HTTPException(status_code=404, detail="Funzionalita disattivata")

        # Override per-tenant: risoluzione leniente (gli endpoint pubblici,
        # es. QR check primo livello, non hanno JWT → vale solo il globale).
        payload = decode_payload_leniently(request)
        if not payload:
            return
        # Il superadmin non resta mai chiuso fuori dalla gestione clienti,
        # anche se il tenant nel contesto ha il modulo disattivato.
        if payload.get("ruolo") == "superadmin" and module_id == "tenant_admin":
            return
        tenant_id = resolve_tenant_id_leniently(request, payload)
        if tenant_id is None:
            return
        try:
            enabled_for_tenant = is_module_enabled_for_tenant(db, module_id, tenant_id)
        except Exception:
            # La config per-tenant non deve mai buttare giù la richiesta:
            # in caso di problemi vale il kill-switch globale già superato.
            return
        if not enabled_for_tenant:
            raise HTTPException(status_code=404, detail="Funzionalita disattivata per questo cliente")
    return _dependency


def _include_module_router(router, module_id: str) -> None:
    app.include_router(router, dependencies=[Depends(_require_module_enabled(module_id))])


# ── Routers legacy (senza prefisso) — mantenuti per retrocompatibilità frontend ──
_MODULE_ROUTERS = [
    (dashboard_router, "dashboard"),
    (assets_router, "assets"),
    (impianti_router, "assets"),
    (siti_router, "assets"),
    (procedure_router, "assets"),
    (note_asset_router, "assets"),
    (check_pl_router, "assets"),
    (asset_documenti_router, "assets"),
    (tecnici_router, "technicians"),
    (tickets_router, "tickets"),
    (scadenze_router, "deadlines"),
    (logs_router, "system_logs"),
    (scheduler_router, "planning"),
    (planning_router, "planning"),
    (manuali_router, "manuals"),
    (diagnostic_router, "diagnostic_ai"),
    (problem_analysis_router, "diagnostic_ai"),
    (failure_engine_router, "diagnostic_ai"),
    (piani_router, "maintenance_plans"),
    (piano_manutenzione_router, "maintenance_plans"),
    (tenants_router, "tenant_admin"),
    (email_config_router, "email_to_ticket"),
    (bulk_import_router, "bulk_import"),
    (utenti_router, "user_admin"),
    (desktop_update_router, "desktop_updates"),
    (conditions_router, "condition_maintenance"),
    (guide_router, "guide_ai"),
    (attestati_router, "compliance"),
    (report_router, "economic_reports"),
    (emergency_router, "emergency"),
    (control_center_router, "control_center"),
]
for _router, _module_id in _MODULE_ROUTERS:
    _include_module_router(_router, _module_id)

# ── Routers v1 (prefisso /v1) — per futura migrazione del frontend ──
# Il frontend può gradualmente migrare da /endpoint a /v1/endpoint.
# Entrambi i path restano attivi finché la migrazione non è completa.
_V1_ROUTERS = [
    (auth_router, None),
    (modules_router, None),
    (dashboard_router, "dashboard"),
    (assets_router, "assets"),
    (tecnici_router, "technicians"),
    (tickets_router, "tickets"),
    (scadenze_router, "deadlines"),
    (manuali_router, "manuals"),
    (diagnostic_router, "diagnostic_ai"),
    (piani_router, "maintenance_plans"),
    (impianti_router, "assets"),
    (siti_router, "assets"),
    (problem_analysis_router, "diagnostic_ai"),
    (planning_router, "planning"),
    (piano_manutenzione_router, "maintenance_plans"),
    (conditions_router, "condition_maintenance"),
]
for _router, _module_id in _V1_ROUTERS:
    if _module_id is None:
        app.include_router(_router, prefix="/v1")
    else:
        app.include_router(
            _router,
            prefix="/v1",
            dependencies=[Depends(_require_module_enabled(_module_id))],
        )

# Mount cartella statica solo in sviluppo locale (in cloud i file sono su Supabase Storage).
# NB: il mount serve i file SENZA autenticazione né isolamento tenant — in produzione
# (anche senza Supabase, es. Render con disco locale) resta vietato: gli allegati e le
# firme vanno serviti solo dagli endpoint autenticati /tickets/allegati/{id}/download
# e /tickets/{id}/firma.
if not os.getenv("SUPABASE_URL") and not IS_PRODUCTION:
    os.makedirs("uploads", exist_ok=True)
    app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")
