"""
Routes: checklist di primo livello per operatori (accesso parzialmente pubblico).
- /assets/{asset_id}/check  → gestione autenticata
- /check/public/{token}     → accesso pubblico senza auth
"""
import json
import logging
import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.core.logger_db import db_info
from backend.db.modelli import Asset, CheckPrimoLivello, Ticket

logger = logging.getLogger(__name__)

router = APIRouter()


# ── Schemi ───────────────────────────────────────────────────────────────────

class VoceCheck(BaseModel):
    label: str
    descrizione: Optional[str] = None


class CheckBody(BaseModel):
    voci: List[VoceCheck] = []


def _serialize(c: CheckPrimoLivello, asset_nome: Optional[str] = None) -> dict:
    return {
        "id": c.id,
        "asset_id": c.asset_id,
        "asset_nome": asset_nome,
        "tenant_id": c.tenant_id,
        "public_token": c.public_token,
        "voci": json.loads(c.voci or "[]"),
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _get_asset_or_404(db: Session, asset_id: int, tenant_id: int) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    return asset


# ── Endpoint autenticati ─────────────────────────────────────────────────────

@router.get("/assets/{asset_id}/check")
def get_check(
    asset_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Ritorna il check di primo livello dell'asset (o null se non configurato)."""
    asset = _get_asset_or_404(db, asset_id, tenant_id)
    check = db.query(CheckPrimoLivello).filter(
        CheckPrimoLivello.asset_id == asset_id,
        CheckPrimoLivello.tenant_id == tenant_id,
    ).first()
    if not check:
        return None
    return _serialize(check, asset_nome=asset.nome)


@router.put("/assets/{asset_id}/check")
def upsert_check(
    asset_id: int,
    body: CheckBody,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Crea o aggiorna il check di primo livello dell'asset."""
    asset = _get_asset_or_404(db, asset_id, tenant_id)
    check = db.query(CheckPrimoLivello).filter(
        CheckPrimoLivello.asset_id == asset_id,
        CheckPrimoLivello.tenant_id == tenant_id,
    ).first()

    voci_json = json.dumps([v.model_dump() for v in body.voci])

    if check:
        check.voci = voci_json
    else:
        check = CheckPrimoLivello(
            asset_id=asset_id,
            tenant_id=tenant_id,
            public_token=str(uuid.uuid4()),
            voci=voci_json,
        )
        db.add(check)

    db.commit()
    db.refresh(check)
    db_info("CHECK_PL", f"Check primo livello aggiornato per asset {asset_id}", {"tenant_id": tenant_id})
    logger.info("Check primo livello asset %s aggiornato", asset_id)
    return _serialize(check, asset_nome=asset.nome)


# ── Endpoint PUBBLICO (no auth) ──────────────────────────────────────────────

@router.get("/check/public/{public_token}")
def get_check_public(
    public_token: str,
    db: Session = Depends(get_db),
):
    """
    Endpoint PUBBLICO — non richiede autenticazione.
    Ritorna asset nome + voci del check tramite token pubblico.
    Usato dagli operatori di produzione via QR code.
    """
    check = db.query(CheckPrimoLivello).filter(
        CheckPrimoLivello.public_token == public_token,
    ).first()
    if not check:
        raise HTTPException(status_code=404, detail="Checklist non trovata")

    # Recupera nome asset (senza filtro tenant — accesso pubblico)
    asset = db.query(Asset).filter(Asset.id == check.asset_id).first()
    asset_nome = asset.nome if asset else f"Asset #{check.asset_id}"

    return _serialize(check, asset_nome=asset_nome)


class SegnalazioneBody(BaseModel):
    descrizione: str
    operatore: Optional[str] = None  # nome operatore (facoltativo, non autenticato)


@router.post("/check/public/{public_token}/segnala", status_code=201)
def segnala_anomalia_pubblica(
    public_token: str,
    body: SegnalazioneBody,
    db: Session = Depends(get_db),
):
    """
    Endpoint PUBBLICO — crea un ticket BD dall'operatore di produzione via QR.
    Non richiede autenticazione: usa il tenant_id del check record.
    """
    from datetime import datetime, timezone

    check = db.query(CheckPrimoLivello).filter(
        CheckPrimoLivello.public_token == public_token,
    ).first()
    if not check:
        raise HTTPException(status_code=404, detail="Checklist non trovata")

    if not body.descrizione or not body.descrizione.strip():
        raise HTTPException(status_code=422, detail="La descrizione è obbligatoria")

    asset = db.query(Asset).filter(Asset.id == check.asset_id).first()
    asset_nome = asset.nome if asset else f"Asset #{check.asset_id}"
    operatore_label = body.operatore.strip() if body.operatore and body.operatore.strip() else "Operatore"

    titolo = f"[CHECK] Anomalia segnalata su {asset_nome}"
    descrizione = (
        f"Segnalazione da operatore di produzione ({operatore_label}) via checklist QR.\n\n"
        f"{body.descrizione.strip()}"
    )

    ticket = Ticket(
        titolo=titolo,
        descrizione=descrizione,
        asset_id=check.asset_id,
        tenant_id=check.tenant_id,
        tipo="BD",
        priorita="Alta",
        stato="Aperto",
        durata_stimata_ore=1.0,
        origin_type="check_public",
        created_by=operatore_label,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    db_info(
        "CHECK_PL",
        f"Anomalia segnalata su asset {check.asset_id} via check pubblico (token={public_token[:8]}…)",
        {"tenant_id": check.tenant_id, "ticket_id": ticket.id},
    )
    logger.info("Ticket BD #%s creato da check pubblico token %s", ticket.id, public_token[:8])

    return {"ticket_id": ticket.id, "messaggio": f"Segnalazione ricevuta — Ticket #{ticket.id} aperto"}
