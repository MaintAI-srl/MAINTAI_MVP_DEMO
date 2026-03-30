
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text

from backend.core.dependencies import get_db
from backend.core.database import engine
from backend.db.modelli import Asset, Manuale

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

@router.post("/db/asset")
def crea_asset_db(nome: str, area: str, db: Session = Depends(get_db)):
    nuovo_asset = Asset(
        nome=nome,
        
        area=area,
        note=""
    )

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


