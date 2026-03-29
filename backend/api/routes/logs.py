from fastapi import APIRouter, Query, HTTPException
from fastapi.responses import PlainTextResponse
import os

router = APIRouter()

LOG_DIR = os.path.join(os.getcwd(), "logs")
LOG_FILE = os.path.join(LOG_DIR, "maintai.log")

@router.get("/logs")
def get_logs(lines: int = Query(100)):
    if not os.path.exists(LOG_FILE):
        return PlainTextResponse("Nessun log trovato.")
    
    with open(LOG_FILE, "r") as f:
        content = f.readlines()
        
    last_lines = content[-lines:] if len(content) > lines else content
    return PlainTextResponse("".join(last_lines))

@router.get("/logs/clear")
def clear_logs():
    if os.path.exists(LOG_FILE):
        os.remove(LOG_FILE)
        return {"status": "success", "message": "Log cancellati correttamente."}
    return {"status": "error", "message": "File di log non trovato."}
