
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from backend.core.config import VERSION, BUILD_DATE
from backend.core.dependencies import get_db

router = APIRouter()

@router.get("/")
def root():
    return {"message": "MaintAI backend attivo"}

@router.get("/version")
def get_version():
    return {
        "version": VERSION,
        "build_date": BUILD_DATE,
        "app": "MaintAI",
        "status": "ok",
    }

@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    db_status = "ok"
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        db_status = "error"

    overall = "ok" if db_status == "ok" else "degraded"
    return {
        "status": overall,
        "version": VERSION,
        "build_date": BUILD_DATE,
        "database": db_status,
    }
