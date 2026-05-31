from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id, require_roles
from backend.repositories.impianto_repository import impianto_repository
from backend.schemas.impianti import ImpiantoCreate, ImpiantoUpdate, GeneraImpiantiMultipliRequest

router = APIRouter()


@router.get("/impianti")
def get_impianti(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    return impianto_repository.get_all(db, tenant_id)


@router.post("/impianti", status_code=201)
def create_impianto(data: ImpiantoCreate, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id), _: dict = Depends(require_roles("responsabile"))):
    return impianto_repository.create(db, data, tenant_id)


@router.post("/impianti/genera-multipli", status_code=201)
def genera_impianti_multipli(data: GeneraImpiantiMultipliRequest, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id), _: dict = Depends(require_roles("responsabile"))):
    return impianto_repository.genera_multipli(
        db,
        sito_id=data.sito_id,
        tipologia=data.tipologia,
        prefisso_nome=data.prefisso_nome,
        quantita=data.quantita,
        dati_comuni=data.dati_comuni,
        tenant_id=tenant_id,
    )


@router.get("/impianti/{imp_id}/tree")
def get_impianto_tree(imp_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    result = impianto_repository.get_tree(db, imp_id, tenant_id)
    if not result:
        raise HTTPException(status_code=404, detail="Impianto non trovato")
    return result


@router.get("/impianti/{imp_id}")
def get_impianto(imp_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    result = impianto_repository.get_by_id(db, imp_id, tenant_id)
    if not result:
        raise HTTPException(status_code=404, detail="Impianto non trovato")
    return result


@router.put("/impianti/{imp_id}")
def update_impianto(imp_id: int, data: ImpiantoUpdate, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id), _: dict = Depends(require_roles("responsabile"))):
    updated = impianto_repository.update(db, imp_id, data, tenant_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Impianto non trovato")
    return updated


@router.delete("/impianti/{imp_id}", status_code=204)
def delete_impianto(imp_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id), _: dict = Depends(require_roles("responsabile"))):
    ok = impianto_repository.delete(db, imp_id, tenant_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Impianto non trovato")
