from fastapi import APIRouter, Query, HTTPException, Depends
from backend.core.security import get_current_user_payload, require_superadmin
from backend.core.dependencies import get_db
from backend.db.modelli import SystemLog
from sqlalchemy.orm import Session
from sqlalchemy import desc
import os

router = APIRouter()

LOG_DIR = os.path.join(os.getcwd(), "logs")
LOG_FILE = os.path.join(LOG_DIR, "maintai.log")


@router.get("/logs")
def get_logs(
    lines: int = Query(100, ge=1, le=1000),
    _payload: dict = Depends(require_superadmin),
):
    """Log file di sistema (solo superadmin — contiene dati globali non filtrati per tenant)."""
    if not os.path.exists(LOG_FILE):
        return {"logs": [], "message": "Nessun log trovato."}

    try:
        with open(LOG_FILE, "r", encoding="utf-8") as f:
            content = f.readlines()
    except OSError:
        return {"logs": [], "message": "Impossibile leggere il file di log."}

    last_lines = content[-lines:] if len(content) > lines else content
    return {"logs": [line.strip() for line in last_lines if line.strip()]}


@router.delete("/logs")
def clear_logs(_payload: dict = Depends(require_superadmin)):
    """Cancella il log file (solo superadmin)."""
    if os.path.exists(LOG_FILE):
        try:
            os.remove(LOG_FILE)
            return {"status": "success", "message": "Log cancellati correttamente."}
        except OSError as e:
            return {"status": "error", "message": f"Impossibile cancellare il file di log: {e}"}
    return {"status": "error", "message": "File di log non trovato."}


@router.get("/system-logs")
def get_system_logs(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    level: str = Query(None),
    module: str = Query(None),
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload)
):
    """Restituisce i log di sistema salvati nel database (filtrati per tenant per i non-superadmin)."""
    if payload.get("ruolo") not in ["superadmin", "responsabile"]:
        raise HTTPException(status_code=403, detail="Accesso negato")

    query = db.query(SystemLog)

    # Filtro tenant (se non superadmin)
    if payload.get("ruolo") != "superadmin":
        query = query.filter(SystemLog.tenant_id == payload.get("tenant_id"))

    if level:
        query = query.filter(SystemLog.level == level.upper())
    if module:
        query = query.filter(SystemLog.module == module.upper())

    total = query.count()
    logs = query.order_by(desc(SystemLog.timestamp)).offset((page - 1) * limit).limit(limit).all()

    return {
        "total": total,
        "page": page,
        "pages": (total + limit - 1) // limit,
        "logs": logs
    }
