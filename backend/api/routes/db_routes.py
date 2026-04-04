
import os
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from backend.core.dependencies import get_db
from backend.core.database import engine, Base
from backend.db.modelli import Asset, Manuale
from backend.core.security import require_superadmin

router = APIRouter()


@router.get("/db/schema/{table_name}")
def get_table_schema(table_name: str):
    """Diagnostica: mostra le colonne di una tabella."""
    with engine.connect() as conn:
        result = conn.execute(text(f"PRAGMA table_info({table_name})"))
        cols = [{"name": r[1], "type": r[2]} for r in result]
    return {"table": table_name, "columns": cols}


@router.post("/db/migrate-now")
def force_migrate():
    """Forza l'esecuzione delle migrazioni. Usa solo in emergenza."""
    from backend.core.init_db import _apply_migrations
    _apply_migrations()
    return {"status": "ok", "message": "Migrazioni eseguite"}


@router.post("/db/reset-emergency")
def reset_emergency(secret: str = Query(...)):
    """
    Reset di emergenza senza JWT — richiede ADMIN_SECRET dall'env.
    Usa: POST /db/reset-emergency?secret=<valore>
    Imposta ADMIN_SECRET nelle env var di Render.
    """
    admin_secret = os.getenv("ADMIN_SECRET", "")
    if not admin_secret or secret != admin_secret:
        raise HTTPException(status_code=403, detail="Secret non valido.")
    from backend.core.init_db import init_db
    Base.metadata.drop_all(bind=engine)
    init_db()
    return {"status": "ok", "message": "DB resettato. Login: admin/admin (superadmin)"}


@router.post("/db/reset")
def reset_database(_payload: dict = Depends(require_superadmin)):
    """
    DISTRUTTIVO — solo superadmin.
    Droppa tutte le tabelle e le ricrea vuote con seed di default
    (tenant Demo, admin/admin superadmin, tecnico/tecnico).
    """
    from backend.core.init_db import init_db

    # Drop tutte le tabelle (ordine inverso per rispettare FK)
    Base.metadata.drop_all(bind=engine)

    # Ricrea schema + seed
    init_db()

    return {
        "status": "ok",
        "message": "Database resettato. Utenti seed: admin/admin (superadmin), tecnico/tecnico."
    }


@router.post("/db/asset")
def crea_asset_db(nome: str, area: str, db: Session = Depends(get_db)):
    nuovo_asset = Asset(nome=nome, area=area, note="")
    db.add(nuovo_asset)
    db.commit()
    db.refresh(nuovo_asset)
    return nuovo_asset

@router.get("/db/asset")
def lista_asset_db(db: Session = Depends(get_db)):
    return db.query(Asset).all()

@router.get("/db/manuali")
def lista_manuali_db(db: Session = Depends(get_db)):
    manuali = db.query(Manuale).order_by(Manuale.id.desc()).all()
    return [
        {
            "id": m.id,
            "nome_file": m.nome_file,
            "pagine": m.pagine,
            "metodo_lettura": m.metodo_lettura,
            "ha_json_ai": bool(m.json_estratto and m.json_estratto.strip()),
        }
        for m in manuali
    ]
