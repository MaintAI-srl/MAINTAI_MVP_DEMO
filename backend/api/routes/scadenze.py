from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.db.modelli import AttivitaManutenzione, Asset, Ticket

router = APIRouter()


@router.get("/scadenze/imminenti")
def get_scadenze_imminenti(
    days: int = Query(7),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Restituisce le attività di manutenzione in scadenza entro 'days' giorni."""
    now = datetime.now(timezone.utc)
    limit = now + timedelta(days=days)

    scadenze = db.query(AttivitaManutenzione).join(Asset).filter(
        Asset.tenant_id == tenant_id,
        AttivitaManutenzione.prossima_scadenza <= limit,
        AttivitaManutenzione.prossima_scadenza >= now - timedelta(days=365),
    ).limit(200).all()

    return [
        {
            "id": s.id,
            "asset_id": s.asset_id,
            "asset_nome": s.asset.nome if s.asset else "N/A",
            "descrizione": s.descrizione,
            "scadenza": s.prossima_scadenza.isoformat() if s.prossima_scadenza else None,
            "urgenza": "alta" if s.prossima_scadenza <= now + timedelta(days=2) else "media"
        } for s in scadenze
    ]


@router.get("/scadenze/calendario")
def get_calendario_scadenze(
    mesi: int = Query(3, ge=1, le=12),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Restituisce scadenze PM per il calendario: attività con prossima_scadenza + ticket PM pianificati."""
    now = datetime.now(timezone.utc)
    fine = now + timedelta(days=mesi * 30)

    # 1. AttivitaManutenzione con prossima_scadenza nell'orizzonte
    attivita = db.query(AttivitaManutenzione).join(Asset, isouter=True).filter(
        AttivitaManutenzione.tenant_id == tenant_id,
        AttivitaManutenzione.prossima_scadenza.isnot(None),
        AttivitaManutenzione.prossima_scadenza >= now - timedelta(days=30),
        AttivitaManutenzione.prossima_scadenza <= fine,
    ).limit(500).all()

    # 2. Batch asset names
    asset_ids = {a.asset_id for a in attivita if a.asset_id}
    assets_map = {a.id: a.nome for a in db.query(Asset).filter(Asset.id.in_(asset_ids)).all()} if asset_ids else {}

    # 3. Ticket PM pianificati (con planned_start nell'orizzonte)
    pm_tickets = db.query(Ticket).filter(
        Ticket.tenant_id == tenant_id,
        Ticket.tipo == "PM",
        Ticket.deleted_at.is_(None),
        Ticket.planned_start.isnot(None),
        Ticket.planned_start >= now - timedelta(days=30),
        Ticket.planned_start <= fine,
        Ticket.stato.in_(["Aperto", "Pianificato", "In corso"]),
    ).limit(300).all()

    eventi_attivita = [
        {
            "tipo": "scadenza",
            "id": a.id,
            "data": a.prossima_scadenza.date().isoformat(),
            "descrizione": a.nome if a.nome else a.descrizione,
            "asset_id": a.asset_id,
            "asset_nome": assets_map.get(a.asset_id, "—"),
            "frequenza_giorni": a.frequenza_giorni,
            "priorita": a.priorita or "Media",
            "urgenza": "alta" if a.prossima_scadenza <= now + timedelta(days=3) else "media",
        }
        for a in attivita
    ]

    eventi_ticket = [
        {
            "tipo": "ticket",
            "id": t.id,
            "data": t.planned_start.date().isoformat(),
            "descrizione": t.titolo,
            "asset_id": t.asset_id,
            "asset_nome": None,  # risolto lato frontend se necessario
            "priorita": t.priorita or "Media",
            "stato": t.stato,
            "urgenza": "alta" if t.priorita and t.priorita.lower() == "alta" else "media",
        }
        for t in pm_tickets
    ]

    return {"eventi": eventi_attivita + eventi_ticket, "mesi": mesi}
