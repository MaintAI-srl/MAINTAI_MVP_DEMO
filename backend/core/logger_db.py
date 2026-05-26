import json

from sqlalchemy.orm import Session

from backend.core.database import SessionLocal
from backend.db.modelli import SystemLog


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

    return str(module).upper(), str(message), extra, tenant_id


def _serialize_extra(extra):
    if extra is None:
        return None
    if isinstance(extra, str):
        return extra
    try:
        return json.dumps(extra, ensure_ascii=False, default=str)
    except TypeError:
        return str(extra)


def log_to_db(level: str, *args, extra: dict = None, tenant_id: int = None):
    """
    Scrive un log persistente nel database.
    Apre una sessione isolata anche quando una route passa per compatibilita
    la propria sessione SQLAlchemy come primo argomento.
    """
    module, message, extra, tenant_id = _normalize_args(args, extra, tenant_id)
    db = SessionLocal()

    try:
        new_log = SystemLog(
            level=str(level).upper(),
            module=module,
            message=message,
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
