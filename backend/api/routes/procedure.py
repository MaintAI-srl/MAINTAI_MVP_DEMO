"""
Routes: procedure operative per asset.
Prefisso: /assets/{asset_id}/procedure
"""
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import List, Optional

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id, require_roles
from backend.core.logger_db import db_info
from backend.db.modelli import Asset, Procedura

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemi Pydantic ──────────────────────────────────────────────────────────

class ProceduraCreate(BaseModel):
    titolo: str
    tipo: str = "ispezione"  # ispezione | sostituzione | taratura | loto | emergenza
    passi: List[str] = []


class ProceduraUpdate(BaseModel):
    titolo: Optional[str] = None
    tipo: Optional[str] = None
    passi: Optional[List[str]] = None


def _serialize(p: Procedura) -> dict:
    return {
        "id": p.id,
        "asset_id": p.asset_id,
        "tenant_id": p.tenant_id,
        "titolo": p.titolo,
        "tipo": p.tipo,
        "passi": json.loads(p.passi or "[]"),
        "revisione": p.revisione,
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def _get_asset_or_404(db: Session, asset_id: int, tenant_id: int) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    return asset


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/assets/{asset_id}/procedure")
def list_procedure(
    asset_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Lista tutte le procedure operative dell'asset."""
    _get_asset_or_404(db, asset_id, tenant_id)
    procedure = (
        db.query(Procedura)
        .filter(Procedura.asset_id == asset_id, Procedura.tenant_id == tenant_id)
        .order_by(Procedura.created_at.asc())
        .all()
    )
    return [_serialize(p) for p in procedure]


@router.post("/assets/{asset_id}/procedure", status_code=201)
def create_procedura(
    asset_id: int,
    body: ProceduraCreate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    _: dict = Depends(require_roles("responsabile")),
):
    """Crea una nuova procedura operativa."""
    _get_asset_or_404(db, asset_id, tenant_id)
    if not body.titolo.strip():
        raise HTTPException(status_code=422, detail="Il titolo è obbligatorio")

    proc = Procedura(
        asset_id=asset_id,
        tenant_id=tenant_id,
        titolo=body.titolo.strip(),
        tipo=body.tipo,
        passi=json.dumps(body.passi),
        revisione=1,
    )
    db.add(proc)
    db.commit()
    db.refresh(proc)
    db_info("PROCEDURE", f"Creata procedura '{proc.titolo}' (id={proc.id}) per asset {asset_id}", {"tenant_id": tenant_id})
    logger.info("Procedura %s creata per asset %s (tenant %s)", proc.id, asset_id, tenant_id)
    return _serialize(proc)


@router.put("/assets/{asset_id}/procedure/{proc_id}")
def update_procedura(
    asset_id: int,
    proc_id: int,
    body: ProceduraUpdate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    _: dict = Depends(require_roles("responsabile")),
):
    """Aggiorna una procedura (incrementa revisione automaticamente)."""
    _get_asset_or_404(db, asset_id, tenant_id)
    proc = db.query(Procedura).filter(
        Procedura.id == proc_id,
        Procedura.asset_id == asset_id,
        Procedura.tenant_id == tenant_id,
    ).first()
    if not proc:
        raise HTTPException(status_code=404, detail="Procedura non trovata")

    if body.titolo is not None:
        proc.titolo = body.titolo.strip()
    if body.tipo is not None:
        proc.tipo = body.tipo
    if body.passi is not None:
        proc.passi = json.dumps(body.passi)
    proc.revisione = (proc.revisione or 1) + 1
    proc.updated_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(proc)
    db_info("PROCEDURE", f"Aggiornata procedura id={proc_id} (rev {proc.revisione})", {"tenant_id": tenant_id})
    logger.info("Procedura %s aggiornata (rev %s)", proc_id, proc.revisione)
    return _serialize(proc)


@router.delete("/assets/{asset_id}/procedure/{proc_id}", status_code=204)
def delete_procedura(
    asset_id: int,
    proc_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    _: dict = Depends(require_roles("responsabile")),
):
    """Elimina una procedura operativa."""
    _get_asset_or_404(db, asset_id, tenant_id)
    proc = db.query(Procedura).filter(
        Procedura.id == proc_id,
        Procedura.asset_id == asset_id,
        Procedura.tenant_id == tenant_id,
    ).first()
    if not proc:
        raise HTTPException(status_code=404, detail="Procedura non trovata")

    db.delete(proc)
    db.commit()
    db_info("PROCEDURE", f"Eliminata procedura id={proc_id} per asset {asset_id}", {"tenant_id": tenant_id})
    logger.info("Procedura %s eliminata", proc_id)
