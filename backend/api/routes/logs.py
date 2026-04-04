from fastapi import APIRouter, Query, HTTPException, Depends
from backend.core.security import get_current_user_payload
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
