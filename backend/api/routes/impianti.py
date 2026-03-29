from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.core.dependencies import get_db
from backend.repositories.impianto_repository import impianto_repository
from backend.schemas.impianti import ImpiantoCreate, ImpiantoUpdate

router = APIRouter()


@router.get("/impianti")
def get_impianti(db: Session = Depends(get_db)):
    return impianto_repository.get_all(db)


@router.post("/impianti", status_code=201)
def create_impianto(data: ImpiantoCreate, db: Session = Depends(get_db)):
    return impianto_repository.create(db, data)


@router.put("/impianti/{imp_id}")
def update_impianto(imp_id: int, data: ImpiantoUpdate, db: Session = Depends(get_db)):
    updated = impianto_repository.update(db, imp_id, data)
    if not updated:
        raise HTTPException(status_code=404, detail="Impianto non trovato")
    return updated


@router.delete("/impianti/{imp_id}", status_code=204)
def delete_impianto(imp_id: int, db: Session = Depends(get_db)):
    ok = impianto_repository.delete(db, imp_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Impianto non trovato")
