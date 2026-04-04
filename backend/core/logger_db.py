import json
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from backend.core.database import SessionLocal
from backend.db.modelli import SystemLog

def log_to_db(level: str, module: str, message: str, extra: dict = None, tenant_id: int = None):
    """
    Scrive un log persistente nel database. 
    Usare SessionLocal internamente per isolare il log dalla transazione principale.
    """
    db = SessionLocal()
    try:
        new_log = SystemLog(
            level=level.upper(),
            module=module.upper(),
            message=message,
            extra_info=json.dumps(extra) if extra else None,
            tenant_id=tenant_id
        )
        db.add(new_log)
        db.commit()
    except Exception as e:
        print(f"CRITICAL: Failed to write system log to DB: {str(e)}")
    finally:
        db.close()

# Helper per un uso più rapido
def db_info(module: str, message: str, extra: dict = None, tenant_id: int = None):
    log_to_db("INFO", module, message, extra, tenant_id)

def db_warn(module: str, message: str, extra: dict = None, tenant_id: int = None):
    log_to_db("WARNING", module, message, extra, tenant_id)

def db_error(module: str, message: str, extra: dict = None, tenant_id: int = None):
    log_to_db("ERROR", module, message, extra, tenant_id)
