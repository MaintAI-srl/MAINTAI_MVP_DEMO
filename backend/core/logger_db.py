import json
import re

from sqlalchemy.orm import Session
from sqlalchemy.orm import sessionmaker

from backend.core.database import SessionLocal, current_db_session
from backend.db.modelli import SystemLog

# ── Redaction centralizzata (privacy/security, ISO 27002 A.8.15) ─────────────
# Chiavi il cui valore non deve MAI finire in SystemLog.extra_info.
_SENSITIVE_KEYS = (
    "password", "passwd", "pwd", "token", "access_token", "refresh_token",
    "authorization", "cookie", "secret", "api_key", "apikey", "raw", "prompt",
    "jwt", "credential", "session",
)
_REDACTED = "[REDACTED]"

# Pattern di segreti dentro stringhe libere (messaggi, snippet raw).
_SECRET_PATTERNS = [
    re.compile(r"sk-[A-Za-z0-9_-]{8,}"),                      # OpenAI API key
    re.compile(r"Bearer\s+[A-Za-z0-9._-]{16,}", re.I),         # header Authorization
    re.compile(r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}"),  # JWT
    re.compile(r"(postgres(?:ql)?|mysql|imaps?)://[^\s@]+:[^\s@]+@", re.I),  # URL con credenziali
]

# Le stringhe extra_info molto lunghe (es. risposte raw AI) vengono troncate.
_MAX_EXTRA_LEN = 4000


def _redact_text(value: str) -> str:
    for pattern in _SECRET_PATTERNS:
        value = pattern.sub(_REDACTED, value)
    return value


def _is_sensitive_key(key) -> bool:
    k = str(key).lower()
    return any(s in k for s in _SENSITIVE_KEYS)


def _redact(value):
    """Redaction ricorsiva di dict/list; le stringhe passano dai pattern di segreti."""
    if isinstance(value, dict):
        return {
            k: (_REDACTED if _is_sensitive_key(k) else _redact(v))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_redact(v) for v in value]
    if isinstance(value, str):
        return _redact_text(value)
    return value


def _normalize_args(args: tuple, extra=None, tenant_id=None):
    """
    Supporta entrambe le firme usate nel codice:
    - db_info("MODULO", "messaggio", extra, tenant_id=1)
    - db_info(db, "MODULO", "messaggio", extra, tenant_id=1)
    """
    if args and isinstance(args[0], Session):
        args = args[1:]

    if len(args) < 2:
        raise TypeError("logger_db richiede module e message")

    module = args[0]
    message = args[1]
    if len(args) >= 3 and extra is None:
        extra = args[2]
    if len(args) >= 4 and tenant_id is None:
        tenant_id = args[3]
    if tenant_id is None and isinstance(extra, dict) and extra.get("tenant_id") is not None:
        tenant_id = extra.get("tenant_id")

    return str(module).upper(), str(message), extra, tenant_id


def _new_log_session():
    """
    Crea una sessione isolata sullo stesso bind della request corrente.

    Questo mantiene il logger compatibile con eventuali DB diversi per request
    senza riutilizzare la sessione business, evitando commit/rollback inattesi.
    """
    request_db = current_db_session.get()
    if isinstance(request_db, Session):
        try:
            bind = request_db.get_bind()
            return sessionmaker(autocommit=False, autoflush=False, bind=bind)()
        except Exception:
            pass
    return SessionLocal()


def _serialize_extra(extra):
    if extra is None:
        return None
    extra = _redact(extra)
    if isinstance(extra, str):
        serialized = extra
    else:
        try:
            serialized = json.dumps(extra, ensure_ascii=False, default=str)
        except TypeError:
            serialized = str(extra)
    if len(serialized) > _MAX_EXTRA_LEN:
        serialized = serialized[:_MAX_EXTRA_LEN] + "…[TRUNCATED]"
    return serialized


def log_to_db(level: str, *args, extra: dict = None, tenant_id: int = None):
    """
    Scrive un log persistente nel database.
    Apre una sessione isolata anche quando una route passa per compatibilita
    la propria sessione SQLAlchemy come primo argomento.
    """
    module, message, extra, tenant_id = _normalize_args(args, extra, tenant_id)
    db = _new_log_session()

    try:
        new_log = SystemLog(
            level=str(level).upper(),
            module=module,
            message=_redact_text(message),
            extra_info=_serialize_extra(extra),
            tenant_id=tenant_id,
        )
        db.add(new_log)
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"CRITICAL: Failed to write system log to DB: {exc}")
    finally:
        db.close()


def db_info(*args, extra: dict = None, tenant_id: int = None):
    log_to_db("INFO", *args, extra=extra, tenant_id=tenant_id)


def db_warn(*args, extra: dict = None, tenant_id: int = None):
    log_to_db("WARNING", *args, extra=extra, tenant_id=tenant_id)


def db_error(*args, extra: dict = None, tenant_id: int = None):
    log_to_db("ERROR", *args, extra=extra, tenant_id=tenant_id)
