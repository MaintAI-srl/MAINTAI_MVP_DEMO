from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.repositories.asset_repository import asset_repository
from backend.schemas.schemas import AssetCreate, AssetUpdate, GeneraAssetMultipliRequest

router = APIRouter()


@router.get("/assets")
def get_assets(
    query: Optional[str] = Query(None),
    sito_id: Optional[int] = Query(None),
    impianto_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(200, ge=1, le=2000),
    db: Session = Depends(get_db), 
    tenant_id: int = Depends(get_current_tenant_id)
):
    return asset_repository.get_all(db, tenant_id, query=query, sito_id=sito_id, impianto_id=impianto_id, limit=limit, page=page)


@router.post("/assets/genera-multipli", status_code=201)
def genera_asset_multipli(data: GeneraAssetMultipliRequest, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    return asset_repository.genera_multipli(db, data, tenant_id)


@router.get("/assets/codice-preview")
def codice_preview(descrizione: str = Query(..., min_length=1), db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    return {"codice": asset_repository.generate_codice_preview(db, descrizione, tenant_id)}


@router.get("/assets/{asset_id}/dettaglio-completo")
def get_dettaglio_completo(asset_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    result = asset_repository.get_dettaglio_completo(db, asset_id, tenant_id)
    if not result:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    return result


@router.get("/assets/{asset_id}/analytics")
def get_asset_analytics(asset_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    asset = asset_repository.get_by_id(db, asset_id, tenant_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    return asset_repository.get_analytics(db, asset_id, tenant_id)


@router.get("/assets/{asset_id}")
def get_asset(asset_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    result = asset_repository.get_by_id(db, asset_id, tenant_id)
    if not result:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    return result


@router.post("/assets", status_code=201)
def create_asset(asset: AssetCreate, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    nome = asset.nome or asset.name or ""
    if not nome.strip():
        raise HTTPException(status_code=422, detail="Il campo 'nome' e' obbligatorio")
    if not asset.area or not asset.area.strip():
        raise HTTPException(status_code=422, detail="Il campo 'area' e' obbligatorio")
    return asset_repository.create(db, asset, tenant_id)


@router.put("/assets/{asset_id}")
def update_asset(asset_id: int, data: AssetUpdate, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    updated = asset_repository.update(db, asset_id, data, tenant_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    return updated


@router.delete("/assets/{asset_id}", status_code=204)
def delete_asset(asset_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    ok = asset_repository.delete(db, asset_id, tenant_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Asset non trovato")
