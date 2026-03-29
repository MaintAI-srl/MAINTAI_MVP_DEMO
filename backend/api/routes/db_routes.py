
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.db.modelli import Asset, Manuale

router = APIRouter()

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


