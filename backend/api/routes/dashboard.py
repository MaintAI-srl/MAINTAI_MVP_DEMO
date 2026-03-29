from datetime import date, timedelta, datetime

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload
from backend.core.dependencies import get_db
from backend.db.modelli import Asset, Tecnico, Ticket, AttivitaManutenzione

router = APIRouter()

# ── Calcolo MTBF ──────────────────────────────────────────────────────────
#
# MTBF (Mean Time Between Failures) per asset:
#   - "Failure" = ticket correttivo chiuso (attivita_manutenzione_id IS NULL, stato="Chiuso")
#   - Total time = giorni dalla creazione del primo ticket o anno installazione
#   - MTBF = total_days / max(n_failures, 1)  [espresso in giorni]
#
# ── Calcolo OEE ───────────────────────────────────────────────────────────
#
# OEE semplificato su finestra 30 giorni:
#   - Planned hours = 8h/giorno × 22 giorni lavorativi ≈ 176h/mese
#   - Downtime = somma durata_stimata_ore dei ticket correttivi chiusi negli ultimi 30 giorni
#   - Availability = (planned - downtime) / planned  (clamp [0,1])
#   - Performance = Quality = 1.0  (dati insufficienti per stima precisa)
#   - OEE = Availability × 100  [%]


def _calcola_kpi_asset(db: Session, asset: Asset) -> dict:
    FINESTRA_GIORNI = 30
    PLANNED_ORE_MESE = 176.0  # 8h × 22 gg lavorativi

    # ticket correttivi = senza piano manutentivo collegato
    correttivi = (
        db.query(Ticket)
        .filter(
            Ticket.asset_id == asset.id,
            Ticket.attivita_manutenzione_id.is_(None),
        )
        .all()
    )
    n_guasti = len(correttivi)

    # MTBF: giorni di vita asset / numero guasti
    # usiamo anno installazione se presente, altrimenti stima da primo ticket
    if asset.anno:
        anni = max(1, date.today().year - asset.anno)
        total_days = anni * 365
    else:
        total_days = 365  # default 1 anno

    mtbf_giorni = total_days / max(n_guasti, 1)

    # OEE: guasti chiusi negli ultimi 30 gg
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
def dashboard(db: Session = Depends(get_db)):
    assets = db.query(Asset).all()
    asset_stati = {"service": 0, "out of service": 0, "stopped": 0}
    for a in assets:
        s = (a.stato or "service").lower()
        if s in asset_stati:
            asset_stati[s] += 1
        else:
            asset_stati["service"] += 1

    tecnici_disponibili = db.query(Tecnico).filter(Tecnico.stato == "in servizio").count()

    return {
        "assets": len(assets),
        "asset_stati": asset_stati,
        "tecnici": db.query(Tecnico).count(),
        "tecnici_disponibili": tecnici_disponibili,
        "ticket_aperti": db.query(Ticket).filter(Ticket.stato == "Aperto").count(),
        "ticket_pianificati": db.query(Ticket).filter(Ticket.stato == "Pianificato").count(),
        "ticket_in_corso": db.query(Ticket).filter(Ticket.stato == "In corso").count(),
        "ticket_chiusi": db.query(Ticket).filter(Ticket.stato == "Chiuso").count(),
    }


@router.get("/dashboard/kpi-asset")
def dashboard_kpi_asset(db: Session = Depends(get_db)):
    """KPI MTBF e OEE aggregati per tutti gli asset."""
    from datetime import timezone
    now = datetime.now(timezone.utc)
    assets = db.query(Asset).all()
    kpi_list = []
    for a in assets:
        k = _calcola_kpi_asset(db, a)
        # Calcola secondi di downtime in tempo reale
        downtime_seconds = None
        stato_changed_at = None
        if a.stato_changed_at:
            ts = a.stato_changed_at
            if ts.tzinfo is None:
                from datetime import timezone
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

    # Aggregati globali
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
def dashboard_charts(db: Session = Depends(get_db)):
    tickets = db.query(Ticket).options(joinedload(Ticket.asset)).all()

    def count_by(field, value):
        return sum(1 for t in tickets if getattr(t, field, None) == value)

    # Stato asset
    assets = db.query(Asset).all()
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
def dashboard_trends(db: Session = Depends(get_db)):
    today = date.today()
    labels = [(today - timedelta(days=i)).strftime("%d/%m") for i in range(6, -1, -1)]
    tickets = db.query(Ticket).filter(Ticket.stato != "Eliminato").all()
    n = len(tickets)
    per_day = [max(0, n // 7 + (1 if i < n % 7 else 0)) for i in range(7)]
    return {"labels": labels, "values": per_day, "total": n}
