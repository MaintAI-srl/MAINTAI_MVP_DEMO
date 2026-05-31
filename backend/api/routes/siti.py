from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id, require_roles
from backend.repositories.sito_repository import sito_repository
from backend.schemas.siti import SitoCreate, SitoUpdate

router = APIRouter()


@router.get("/siti")
def get_siti(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    return sito_repository.get_all(db, tenant_id)


@router.post("/siti", status_code=201)
def create_sito(data: SitoCreate, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id), _: dict = Depends(require_roles("responsabile"))):
    return sito_repository.create(db, data, tenant_id)


@router.get("/siti/tree")
def get_all_tree(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    return sito_repository.get_all_tree(db, tenant_id)


@router.get("/siti/{sito_id}")
def get_sito(sito_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    result = sito_repository.get_by_id(db, sito_id, tenant_id)
    if not result:
        raise HTTPException(status_code=404, detail="Sito non trovato")
    return result


@router.put("/siti/{sito_id}")
def update_sito(sito_id: int, data: SitoUpdate, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id), _: dict = Depends(require_roles("responsabile"))):
    result = sito_repository.update(db, sito_id, data, tenant_id)
    if not result:
        raise HTTPException(status_code=404, detail="Sito non trovato")
    return result


@router.delete("/siti/{sito_id}", status_code=204)
def delete_sito(sito_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id), _: dict = Depends(require_roles("responsabile"))):
    ok = sito_repository.delete(db, sito_id, tenant_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Sito non trovato")


@router.get("/siti/{sito_id}/tree")
def get_sito_tree(sito_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    result = sito_repository.get_tree(db, sito_id, tenant_id)
    if not result:
        raise HTTPException(status_code=404, detail="Sito non trovato")
    return result
