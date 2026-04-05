
import traceback
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text, inspect
from backend.core.config import VERSION, BUILD_DATE, OPENAI_API_KEY
from backend.core.dependencies import get_db
from backend.core.database import DATABASE_URL

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
        "openai": "configured" if OPENAI_API_KEY else "missing",
    }

@router.get("/debug/db")
def debug_db(db: Session = Depends(get_db)):
    """Endpoint temporaneo di diagnostica — rimuovere dopo il debug."""
    result = {"db_url_type": DATABASE_URL.split("://")[0], "checks": []}
    try:
        db.execute(text("SELECT 1"))
        result["checks"].append("SELECT 1: OK")
    except Exception as e:
        result["checks"].append(f"SELECT 1: FAIL — {e}")

    try:
        from backend.db.modelli import Asset
        insp = inspect(db.bind)
        cols = [c["name"] for c in insp.get_columns("asset")]
        result["asset_columns"] = cols
        result["checks"].append(f"inspect asset: OK ({len(cols)} cols)")
    except Exception as e:
        result["checks"].append(f"inspect asset: FAIL — {e}")

    try:
        from backend.db.modelli import Asset
        count = db.query(Asset).count()
        result["checks"].append(f"query Asset count: OK ({count})")
    except Exception as e:
        result["checks"].append(f"query Asset FAIL — {traceback.format_exc()}")

    try:
        from backend.db.modelli import Tecnico
        count = db.query(Tecnico).count()
        result["checks"].append(f"query Tecnico count: OK ({count})")
    except Exception as e:
        result["checks"].append(f"query Tecnico FAIL — {str(e)}")

    # Test demo.db (SQLite)
    try:
        from backend.core.database import DEMO_DATABASE_URL, demo_engine
        from sqlalchemy import inspect as sa_inspect, text as sa_text
        insp2 = sa_inspect(demo_engine)
        demo_cols = [c["name"] for c in insp2.get_columns("asset")] if "asset" in insp2.get_table_names() else []
        result["demo_asset_columns"] = demo_cols
        result["demo_has_weather_constraint"] = "weather_constraint" in demo_cols
        # Try query on demo db
        with demo_engine.connect() as c2:
            r = c2.execute(sa_text("SELECT count(*) FROM asset")).scalar()
            result["checks"].append(f"demo.db query Asset count: OK ({r})")
    except Exception as e:
        result["checks"].append(f"demo.db FAIL — {str(e)[:200]}")

    result["deploy_ts"] = "2026-04-05T_fix3"
    return result


@router.get("/test-openai")
def test_openai():
    ai_client = get_openai_client()

    print(">>> TEST OPENAI CHIAMATO")

    response = ai_client.responses.create(
        model="gpt-4.1-mini",
        input="Rispondi solo con: ok openai"
    )

    print(">>> RESPONSE ID:", response.id)
    print(">>> OUTPUT:", response.output_text)

    return {
        "status": "ok",
        "output": response.output_text,
        "response_id": response.id
    }

