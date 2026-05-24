import io
import os
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import func
from sqlalchemy.orm import Session
from typing import Optional, List
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.repositories.asset_repository import asset_repository
from backend.schemas.schemas import AssetCreate, AssetUpdate, GeneraAssetMultipliRequest
from backend.db.modelli import Ticket, Asset
from backend.core.logger_db import db_info, db_error

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


@router.get("/assets/{asset_id}/kpi")
def get_asset_kpi(
    asset_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Calcola KPI operativi per un asset:
    - mtbf_giorni: media giorni fra ticket BD/CM chiusi (None se < 2 guasti)
    - mttr_ore: media durata ticket BD/CM chiusi
    - n_guasti_90gg: count ticket BD/CM negli ultimi 90gg
    - disponibilita_pct: mtbf / (mtbf + mttr/24) * 100
    """
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")

    now = datetime.now(timezone.utc)
    cutoff_90 = now - timedelta(days=90)

    # Ticket BD/CM chiusi — ordinati per data creazione
    ticket_chiusi = (
        db.query(Ticket)
        .filter(
            Ticket.asset_id == asset_id,
            Ticket.tenant_id == tenant_id,
            Ticket.tipo.in_(["BD", "CM"]),
            Ticket.stato == "Chiuso",
            Ticket.deleted_at.is_(None),
        )
        .order_by(Ticket.created_at.asc())
        .all()
    )

    # MTBF — media giorni fra ticket chiusi consecutivi
    mtbf_giorni = None
    if len(ticket_chiusi) >= 2:
        date_list = []
        for t in ticket_chiusi:
            ts = t.created_at
            if ts and ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            if ts:
                date_list.append(ts)
        if len(date_list) >= 2:
            gaps = [(date_list[i+1] - date_list[i]).total_seconds() / 86400 for i in range(len(date_list)-1)]
            mtbf_giorni = round(sum(gaps) / len(gaps), 1)

    # MTTR — media durata ticket BD/CM chiusi (usa execution_finish-execution_start o durata_stimata_ore)
    mttr_ore = None
    durate = []
    for t in ticket_chiusi:
        if t.execution_start and t.execution_finish:
            ore = (t.execution_finish - t.execution_start).total_seconds() / 3600
            if ore > 0:
                durate.append(ore)
        elif t.durata_stimata_ore and t.durata_stimata_ore > 0:
            durate.append(t.durata_stimata_ore)
    if durate:
        mttr_ore = round(sum(durate) / len(durate), 2)

    # N.Guasti 90gg
    n_guasti_90gg = (
        db.query(func.count(Ticket.id))
        .filter(
            Ticket.asset_id == asset_id,
            Ticket.tenant_id == tenant_id,
            Ticket.tipo.in_(["BD", "CM"]),
            Ticket.created_at >= cutoff_90,
            Ticket.deleted_at.is_(None),
        )
        .scalar() or 0
    )

    # Disponibilità % = mtbf / (mtbf + mttr/24) * 100
    disponibilita_pct = None
    if mtbf_giorni is not None and mttr_ore is not None and mttr_ore > 0:
        mttr_giorni = mttr_ore / 24
        disponibilita_pct = round(mtbf_giorni / (mtbf_giorni + mttr_giorni) * 100, 1)

    db_info("ASSET_KPI", f"KPI calcolati per asset {asset_id}: mtbf={mtbf_giorni}, mttr={mttr_ore}", {"asset_id": asset_id}, tenant_id=tenant_id)

    return {
        "asset_id": asset_id,
        "asset_nome": asset.nome,
        "mtbf_giorni": mtbf_giorni,
        "mttr_ore": mttr_ore,
        "n_guasti_90gg": n_guasti_90gg,
        "disponibilita_pct": disponibilita_pct,
        "n_guasti_totali": len(ticket_chiusi),
    }


@router.get("/assets/{asset_id}/qrcode")
def get_asset_qrcode(
    asset_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Genera un QR code PNG che punta alla pagina storico dell'asset.
    L'URL di destinazione è {FRONTEND_URL}/storico/{asset_id}.
    """
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")

    try:
        import segno  # type: ignore
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="Libreria segno non disponibile. Installare con: pip install segno",
        )

    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    target_url = f"{frontend_url}/storico/{asset_id}"

    qr = segno.make(target_url, error="l")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=8, dark="#111827", light="#f8fafc", border=2)
    svg_bytes = buf.getvalue()

    db_info("ASSET_QR", f"QR code generato per asset {asset_id}: {target_url}", {"tenant_id": tenant_id})

    return Response(
        content=svg_bytes,
        media_type="image/svg+xml",
        headers={
            "Content-Disposition": f'attachment; filename="qr-asset-{asset_id}.svg"',
            "Cache-Control": "public, max-age=86400",
        },
    )


@router.get("/assets/{asset_id}/ricambi-suggeriti", tags=["integration-future"])
def get_ricambi_suggeriti(
    asset_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Stub — predisposizione integrazione modulo ricambi esterno.
    Restituisce sempre lista vuota. Sarà popolato dal modulo esterno.
    """
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    return {
        "asset_id": asset_id,
        "ricambi": [],
        "note": "Modulo ricambi non ancora disponibile. Disponibile prossimamente.",
        "codice_ricambio_esterno": getattr(asset, "codice_ricambio_esterno", None),
    }
