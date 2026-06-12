"""
Routes: checklist di primo livello per operatori (accesso parzialmente pubblico).
- /assets/{asset_id}/check  → gestione autenticata
- /check/public/{token}     → accesso pubblico senza auth
"""
import json
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.core.logger_db import db_info
from backend.core.rate_limiter import limiter
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
        "token_active": c.token_active if c.token_active is not None else True,
        "token_expires_at": c.token_expires_at.isoformat() if c.token_expires_at else None,
        "voci": json.loads(c.voci or "[]"),
        "created_at": c.created_at.isoformat() if c.created_at else None,
    }


def _get_asset_or_404(db: Session, asset_id: int, tenant_id: int) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    return asset


def _check_token_valid(check: CheckPrimoLivello) -> None:
    """Verifica che il token sia attivo e non scaduto. Solleva HTTP 404 in caso contrario."""
    token_active = check.token_active if check.token_active is not None else True
    if not token_active:
        raise HTTPException(status_code=404, detail="Checklist non disponibile")
    if check.token_expires_at and check.token_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=404, detail="Checklist non disponibile")


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
        # Aggiornamento: mantieni token_active e token_expires_at invariati
        check.voci = voci_json
    else:
        # Creazione: imposta scadenza a 365 giorni dalla creazione
        check = CheckPrimoLivello(
            asset_id=asset_id,
            tenant_id=tenant_id,
            public_token=str(uuid.uuid4()),
            voci=voci_json,
            token_active=True,
            token_expires_at=datetime.now(timezone.utc) + timedelta(days=365),
        )
        db.add(check)

    db.commit()
    db.refresh(check)
    db_info("CHECK_PL", f"Check primo livello aggiornato per asset {asset_id}", {"tenant_id": tenant_id})
    logger.info("Check primo livello asset %s aggiornato", asset_id)
    return _serialize(check, asset_nome=asset.nome)


@router.post("/assets/{asset_id}/check/rotate-token")
def rotate_qr_token(
    asset_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Genera un nuovo token pubblico per il QR code dell'asset, invalidando il precedente."""
    check = db.query(CheckPrimoLivello).filter_by(asset_id=asset_id, tenant_id=tenant_id).first()
    if not check:
        raise HTTPException(status_code=404, detail="Check non trovato")
    check.public_token = str(uuid.uuid4())
    check.token_active = True
    check.token_expires_at = datetime.now(timezone.utc) + timedelta(days=365)
    db.commit()
    db.refresh(check)
    db_info(
        "CHECK_PL",
        f"Token QR ruotato per asset {asset_id}",
        {"tenant_id": tenant_id, "new_token_prefix": check.public_token[:8]},
    )
    # Il prefisso del token resta solo nel log strutturato db_info; niente token nei log testuali.
    logger.info("Codice QR check ruotato per asset %s", asset_id)
    return {
        "public_token": check.public_token,
        "token_expires_at": check.token_expires_at.isoformat() if check.token_expires_at else None,
    }


# ── Endpoint PUBBLICO (no auth) ──────────────────────────────────────────────

@router.get("/check/public/{public_token}")
@limiter.limit("30/minute")
def get_check_public(
    public_token: str,
    request: Request,
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

    # P1-05: verifica che il token sia attivo e non scaduto
    _check_token_valid(check)

    # Recupera nome asset (senza filtro tenant — accesso pubblico)
    asset = db.query(Asset).filter(Asset.id == check.asset_id).first()
    asset_nome = asset.nome if asset else f"Asset #{check.asset_id}"

    # Risposta pubblica: NON espone tenant_id né public_token (dati interni)
    return {
        "id": check.id,
        "asset_id": check.asset_id,
        "asset_nome": asset_nome,
        "voci": json.loads(check.voci or "[]"),
        "created_at": check.created_at.isoformat() if check.created_at else None,
    }


class SegnalazioneBody(BaseModel):
    descrizione: str = Field(..., min_length=1, max_length=2000)
    operatore: Optional[str] = Field(None, max_length=100)  # nome operatore (facoltativo, non autenticato)


@router.post("/check/public/{public_token}/segnala", status_code=201)
@limiter.limit("10/minute")
def segnala_anomalia_pubblica(
    public_token: str,
    request: Request,
    body: SegnalazioneBody,
    db: Session = Depends(get_db),
):
    """
    Endpoint PUBBLICO — crea un ticket BD dall'operatore di produzione via QR.
    Non richiede autenticazione: usa il tenant_id del check record.
    """
    check = db.query(CheckPrimoLivello).filter(
        CheckPrimoLivello.public_token == public_token,
    ).first()
    if not check:
        raise HTTPException(status_code=404, detail="Checklist non trovata")

    # P1-05: verifica che il token sia attivo e non scaduto
    _check_token_valid(check)

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
    logger.info("Ticket BD #%s creato da check pubblico", ticket.id)

    # P1-05: risposta pubblica — solo ticket_id e messaggio (NON tenant_id né public_token)
    return {"ticket_id": ticket.id, "messaggio": f"Segnalazione ricevuta — Ticket #{ticket.id} aperto"}
