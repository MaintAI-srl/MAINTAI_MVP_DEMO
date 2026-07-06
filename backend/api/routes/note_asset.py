"""
Routes: nota tecnica senior per asset (upsert — una sola nota per asset).
Prefisso: /assets/{asset_id}/nota-senior
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id, require_roles
from backend.core.logger_db import db_info
from backend.db.modelli import Asset, NotaAsset

logger = logging.getLogger(__name__)

router = APIRouter()


class NotaAssetBody(BaseModel):
    testo: str


def _get_asset_or_404(db: Session, asset_id: int, tenant_id: int) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    return asset


def _serialize(n: NotaAsset) -> dict:
    return {
        "id": n.id,
        "asset_id": n.asset_id,
        "tenant_id": n.tenant_id,
        "testo": n.testo,
        "autore": n.autore,
        "created_at": n.created_at.isoformat() if n.created_at else None,
        "updated_at": n.updated_at.isoformat() if n.updated_at else None,
    }


@router.get("/assets/{asset_id}/nota-senior")
def get_nota_senior(
    asset_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Ritorna l'ultima nota tecnica senior dell'asset (o null se assente)."""
    _get_asset_or_404(db, asset_id, tenant_id)
    nota = db.query(NotaAsset).filter(
        NotaAsset.asset_id == asset_id,
        NotaAsset.tenant_id == tenant_id,
    ).order_by(NotaAsset.updated_at.desc()).first()
    if not nota:
        return None
    return _serialize(nota)


@router.put("/assets/{asset_id}/nota-senior")
def upsert_nota_senior(
    asset_id: int,
    body: NotaAssetBody,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    payload: dict = Depends(require_roles("responsabile", "tecnico")),
):
    """Crea o aggiorna (upsert) la nota tecnica senior dell'asset."""
    _get_asset_or_404(db, asset_id, tenant_id)
    if not body.testo.strip():
        raise HTTPException(status_code=422, detail="Il testo della nota è obbligatorio")

    autore = payload.get("sub") or "sconosciuto"

    nota = db.query(NotaAsset).filter(
        NotaAsset.asset_id == asset_id,
        NotaAsset.tenant_id == tenant_id,
    ).first()

    if nota:
        nota.testo = body.testo.strip()
        nota.autore = autore
        nota.updated_at = datetime.now(timezone.utc)
    else:
        nota = NotaAsset(
            asset_id=asset_id,
            tenant_id=tenant_id,
            testo=body.testo.strip(),
            autore=autore,
        )
        db.add(nota)

    db.commit()
    db.refresh(nota)
    db_info("NOTE_ASSET", f"Nota senior aggiornata per asset {asset_id} da {autore}", {"tenant_id": tenant_id})
    logger.info("Nota senior asset %s aggiornata da %s", asset_id, autore)
    return _serialize(nota)
