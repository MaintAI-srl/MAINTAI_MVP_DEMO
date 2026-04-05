from fastapi import APIRouter, HTTPException
from backend.demo_data import seed_demo_db, DEMO_DB_PATH
import os

router = APIRouter(prefix="/demo", tags=["demo"])

@router.get("/activate")
def activate_demo():
    """
    Assicura che il database demo sia inizializzato.
    Restituisce conferma dell'attivazione.
    """
    try:
        # Inizializza il DB se non esiste o forzane il ripristino
        # (Idealmente qui potremmo solo controllare se esiste, ma il seeding è veloce)
        seed_demo_db()
        return {"status": "success", "message": "Modalità DEMO attivata. Database inizializzato."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore durante l'attivazione della demo: {str(e)}")
