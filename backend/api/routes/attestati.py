"""
Routes: attestati di formazione / qualifiche tecnici.
- /tecnici/{tecnico_id}/attestati  → CRUD per tecnico
- /attestati/scadenze              → lista scadenze prossime (90gg) per il tenant
"""
import logging
from datetime import date, datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.core.logger_db import db_info, db_error
from backend.db.modelli import Tecnico, Attestato

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemi ───────────────────────────────────────────────────────────────────

class AttestatiCreate(BaseModel):
    tipo_corso: str
    ente_certificatore: Optional[str] = None
    data_conseguimento: Optional[date] = None
    data_scadenza: Optional[date] = None
    note: Optional[str] = None


def _serialize(a: Attestato, tecnico_nome: Optional[str] = None) -> dict:
    return {
        "id": a.id,
        "tecnico_id": a.tecnico_id,
        "tecnico_nome": tecnico_nome,
        "tenant_id": a.tenant_id,
        "tipo_corso": a.tipo_corso,
        "ente_certificatore": a.ente_certificatore,
        "data_conseguimento": a.data_conseguimento.isoformat() if a.data_conseguimento else None,
        "data_scadenza": a.data_scadenza.isoformat() if a.data_scadenza else None,
        "note": a.note,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        # giorni_mancanti: null se nessuna scadenza, negativo se già scaduto
        "giorni_mancanti": (a.data_scadenza - date.today()).days if a.data_scadenza else None,
    }


def _get_tecnico_or_404(db: Session, tecnico_id: int, tenant_id: int) -> Tecnico:
    t = db.query(Tecnico).filter(Tecnico.id == tecnico_id, Tecnico.tenant_id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tecnico non trovato")
    return t


# ── CRUD per tecnico ─────────────────────────────────────────────────────────

@router.get("/tecnici/{tecnico_id}/attestati")
def list_attestati(
    tecnico_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Lista degli attestati di un tecnico."""
    tecnico = _get_tecnico_or_404(db, tecnico_id, tenant_id)
    attestati = (
        db.query(Attestato)
        .filter(Attestato.tecnico_id == tecnico_id, Attestato.tenant_id == tenant_id)
        .order_by(Attestato.data_scadenza.asc().nullslast())
        .all()
    )
    tecnico_nome = f"{tecnico.nome} {tecnico.cognome or ''}".strip()
    return [_serialize(a, tecnico_nome=tecnico_nome) for a in attestati]


@router.post("/tecnici/{tecnico_id}/attestati", status_code=201)
def create_attestato(
    tecnico_id: int,
    body: AttestatiCreate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Aggiunge un attestato a un tecnico."""
    tecnico = _get_tecnico_or_404(db, tecnico_id, tenant_id)
    if not body.tipo_corso.strip():
        raise HTTPException(status_code=422, detail="Il tipo corso è obbligatorio")

    att = Attestato(
        tecnico_id=tecnico_id,
        tenant_id=tenant_id,
        tipo_corso=body.tipo_corso.strip(),
        ente_certificatore=body.ente_certificatore,
        data_conseguimento=body.data_conseguimento,
        data_scadenza=body.data_scadenza,
        note=body.note,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    tecnico_nome = f"{tecnico.nome} {tecnico.cognome or ''}".strip()
    db_info("ATTESTATI", f"Attestato '{att.tipo_corso}' aggiunto a tecnico {tecnico_id}", {"tenant_id": tenant_id})
    logger.info("Attestato %s creato per tecnico %s", att.id, tecnico_id)
    return _serialize(att, tecnico_nome=tecnico_nome)


@router.delete("/tecnici/{tecnico_id}/attestati/{att_id}", status_code=204)
def delete_attestato(
    tecnico_id: int,
    att_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Elimina un attestato."""
    _get_tecnico_or_404(db, tecnico_id, tenant_id)
    att = db.query(Attestato).filter(
        Attestato.id == att_id,
        Attestato.tecnico_id == tecnico_id,
        Attestato.tenant_id == tenant_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attestato non trovato")
    db.delete(att)
    db.commit()
    db_info("ATTESTATI", f"Eliminato attestato id={att_id} del tecnico {tecnico_id}", {"tenant_id": tenant_id})
    logger.info("Attestato %s eliminato", att_id)


# ── Scadenzario ──────────────────────────────────────────────────────────────

@router.get("/attestati/scadenze")
def get_scadenze(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Lista tutti gli attestati in scadenza nei prossimi 90 giorni per il tenant.
    Include anche i già scaduti (giorni_mancanti < 0).
    Ordinati per data_scadenza ascendente.
    """
    oggi = date.today()
    limite = oggi + timedelta(days=90)

    attestati = (
        db.query(Attestato)
        .join(Tecnico, Attestato.tecnico_id == Tecnico.id)
        .filter(
            Attestato.tenant_id == tenant_id,
            Attestato.data_scadenza.isnot(None),
            Attestato.data_scadenza <= limite,
        )
        .order_by(Attestato.data_scadenza.asc())
        .all()
    )

    result = []
    for a in attestati:
        tecnico = db.query(Tecnico).filter(Tecnico.id == a.tecnico_id).first()
        tecnico_nome = f"{tecnico.nome} {tecnico.cognome or ''}".strip() if tecnico else f"Tecnico #{a.tecnico_id}"
        result.append(_serialize(a, tecnico_nome=tecnico_nome))

    return result
