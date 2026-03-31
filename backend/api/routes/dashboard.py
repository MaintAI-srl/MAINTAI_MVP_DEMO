from datetime import date, timedelta, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.db.modelli import Asset, Tecnico, Ticket, AttivitaManutenzione

router = APIRouter()

FINESTRA_GIORNI = 30
PLANNED_ORE_MESE = 176.0


def _calcola_kpi_asset(db: Session, asset: Asset, tenant_id: int) -> dict:
    correttivi = (
        db.query(Ticket)
        .filter(
            Ticket.asset_id == asset.id,
            Ticket.tenant_id == tenant_id,
            Ticket.attivita_manutenzione_id.is_(None),
        )
        .all()
    )
    n_guasti = len(correttivi)

    if asset.anno:
        anni = max(1, date.today().year - asset.anno)
        total_days = anni * 365
    else:
        total_days = 365

    mtbf_giorni = total_days / max(n_guasti, 1)

    cutoff = datetime.now() - timedelta(days=FINESTRA_GIORNI)
    downtime_ore = sum(
        (t.durata_stimata_ore or 0)
        for t in correttivi
        if t.stato == "Chiuso" and t.execution_finish and t.execution_finish >= cutoff
    )
    availability = max(0.0, min(1.0, (PLANNED_ORE_MESE - downtime_ore) / PLANNED_ORE_MESE))
    oee = round(availability * 100, 1)

    return {
        "mtbf_giorni": round(mtbf_giorni, 1),
        "oee_pct": oee,
        "n_guasti": n_guasti,
        "downtime_ore_30gg": round(downtime_ore, 1),
    }


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    assets = db.query(Asset).filter(Asset.tenant_id == tenant_id).all()
    asset_stati = {"service": 0, "out of service": 0, "stopped": 0}
    for a in assets:
        s = (a.stato or "service").lower()
        if s in asset_stati:
            asset_stati[s] += 1
        else:
            asset_stati["service"] += 1

    tecnici_disponibili = db.query(Tecnico).filter(
        Tecnico.tenant_id == tenant_id,
        Tecnico.stato == "in servizio",
    ).count()

    return {
        "assets": len(assets),
        "asset_stati": asset_stati,
        "tecnici": db.query(Tecnico).filter(Tecnico.tenant_id == tenant_id).count(),
        "tecnici_disponibili": tecnici_disponibili,
        "ticket_aperti": db.query(Ticket).filter(Ticket.tenant_id == tenant_id, Ticket.stato == "Aperto").count(),
        "ticket_pianificati": db.query(Ticket).filter(Ticket.tenant_id == tenant_id, Ticket.stato == "Pianificato").count(),
        "ticket_in_corso": db.query(Ticket).filter(Ticket.tenant_id == tenant_id, Ticket.stato == "In corso").count(),
        "ticket_chiusi": db.query(Ticket).filter(Ticket.tenant_id == tenant_id, Ticket.stato == "Chiuso").count(),
    }


@router.get("/dashboard/kpi-asset")
def dashboard_kpi_asset(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    from datetime import timezone
    now = datetime.now(timezone.utc)
    assets = db.query(Asset).filter(Asset.tenant_id == tenant_id).all()
    kpi_list = []
    for a in assets:
        k = _calcola_kpi_asset(db, a, tenant_id)
        downtime_seconds = None
        stato_changed_at = None
        if a.stato_changed_at:
            ts = a.stato_changed_at
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            stato_changed_at = ts.isoformat()
            if a.stato == "out of service":
                downtime_seconds = int((now - ts).total_seconds())

        kpi_list.append({
            "asset_id": a.id,
            "asset_nome": a.nome,
            "asset_codice": a.codice or "",
            "stato": a.stato or "service",
            "stato_changed_at": stato_changed_at,
            "downtime_seconds": downtime_seconds,
            **k,
        })

    if kpi_list:
        avg_mtbf = sum(k["mtbf_giorni"] for k in kpi_list) / len(kpi_list)
        avg_oee = sum(k["oee_pct"] for k in kpi_list) / len(kpi_list)
    else:
        avg_mtbf = avg_oee = 0.0

    return {
        "assets": kpi_list,
        "aggregati": {
            "avg_mtbf_giorni": round(avg_mtbf, 1),
            "avg_oee_pct": round(avg_oee, 1),
        },
    }


@router.get("/dashboard/charts")
def dashboard_charts(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    tickets = db.query(Ticket).options(joinedload(Ticket.asset)).filter(Ticket.tenant_id == tenant_id).all()

    def count_by(field, value):
        return sum(1 for t in tickets if getattr(t, field, None) == value)

    assets = db.query(Asset).filter(Asset.tenant_id == tenant_id).all()
    stati_asset = {}
    for a in assets:
        s = a.stato or "service"
        stati_asset[s] = stati_asset.get(s, 0) + 1

    return {
        "ticket_by_priority": [
            {"name": "Alta",  "value": count_by("priorita", "Alta")},
            {"name": "Media", "value": count_by("priorita", "Media")},
            {"name": "Bassa", "value": count_by("priorita", "Bassa")},
        ],
        "ticket_by_status": [
            {"name": "Aperto",      "value": count_by("stato", "Aperto")},
            {"name": "Pianificato", "value": count_by("stato", "Pianificato")},
            {"name": "In corso",    "value": count_by("stato", "In corso")},
            {"name": "Chiuso",      "value": count_by("stato", "Chiuso")},
        ],
        "ticket_by_fascia": [
            {"name": "Diurna",   "value": count_by("fascia_oraria", "diurna")},
            {"name": "Notturna", "value": count_by("fascia_oraria", "notturna")},
        ],
        "ticket_by_tipo": [
            {"name": "PM", "value": count_by("tipo", "PM")},
            {"name": "CM", "value": count_by("tipo", "CM")},
            {"name": "BD", "value": count_by("tipo", "BD")},
            {"name": "ISP", "value": count_by("tipo", "ISP")},
        ],
        "asset_by_stato": [{"name": k, "value": v} for k, v in stati_asset.items()],
    }


@router.get("/dashboard/trends")
def dashboard_trends(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    today = date.today()
    labels = [(today - timedelta(days=i)).strftime("%d/%m") for i in range(6, -1, -1)]
    tickets = db.query(Ticket).filter(Ticket.tenant_id == tenant_id, Ticket.stato != "Eliminato").all()
    n = len(tickets)
    per_day = [max(0, n // 7 + (1 if i < n % 7 else 0)) for i in range(7)]
    return {"labels": labels, "values": per_day, "total": n}
