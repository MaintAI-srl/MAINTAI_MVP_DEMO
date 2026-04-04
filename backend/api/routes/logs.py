from fastapi import APIRouter, Query, HTTPException, Depends
from backend.core.security import get_current_user_payload
from backend.core.database import get_db
from backend.db.modelli import SystemLog
from sqlalchemy.orm import Session
from sqlalchemy import desc
import os

router = APIRouter()

LOG_DIR = os.path.join(os.getcwd(), "logs")
LOG_FILE = os.path.join(LOG_DIR, "maintai.log")

@router.get("/logs")
def get_logs(
    lines: int = Query(100),
    payload: dict = Depends(get_current_user_payload)
):
    if payload.get("ruolo") not in ["superadmin", "responsabile"]:
        raise HTTPException(status_code=403, detail="Accesso negato")
        
    if not os.path.exists(LOG_FILE):
        return {"logs": [], "message": "Nessun log trovato."}
    
    with open(LOG_FILE, "r") as f:
        content = f.readlines()
        
    last_lines = content[-lines:] if len(content) > lines else content
    return {"logs": [line.strip() for line in last_lines if line.strip()]}

@router.get("/logs/clear")
def clear_logs(payload: dict = Depends(get_current_user_payload)):
    if payload.get("ruolo") not in ["superadmin", "responsabile"]:
        raise HTTPException(status_code=403, detail="Accesso negato")

    if os.path.exists(LOG_FILE):
        os.remove(LOG_FILE)
        return {"status": "success", "message": "Log cancellati correttamente."}
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
    """Restituisce i log di sistema salvati nel database."""
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

