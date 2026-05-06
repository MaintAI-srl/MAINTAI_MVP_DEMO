from datetime import date, timedelta, datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, case, distinct
from sqlalchemy.orm import Session, joinedload
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.db.modelli import Asset, Impianto, Sito, Tecnico, Ticket, AttivitaManutenzione

router = APIRouter()

TEMPO_PROGRAMMATO_H = 720.0  # ore/mese


def _asset_stato_key(stato: str | None) -> str:
    value = (stato or "service").strip().lower()
    if value in {"operativo", "in servizio", "in_servizio"}:
        return "service"
    if value in {"fermo", "fermo prog", "fermo prog.", "fermo programmato", "fermo_prog"}:
        return "stopped"
    if value in {"guasto", "oos", "fuori servizio", "out_of_service"}:
        return "out of service"
    if value in {"service", "stopped", "out of service"}:
        return value
    return "service"


def _asset_stato_label(stato: str | None) -> str:
    return {
        "service": "OPERATIVO",
        "stopped": "FERMO PROG.",
        "out of service": "GUASTO",
    }[_asset_stato_key(stato)]


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    # Tutto in query aggregate — niente loop Python
    asset_stati_rows = (
        db.query(Asset.stato, func.count(Asset.id))
        .filter(Asset.tenant_id == tenant_id)
        .group_by(Asset.stato)
        .all()
    )
    asset_stati = {"service": 0, "out of service": 0, "stopped": 0}
    total_assets = 0
    for stato, cnt in asset_stati_rows:
        s = _asset_stato_key(stato)
        asset_stati[s] = asset_stati.get(s, 0) + cnt
        total_assets += cnt

    tecnici_total = db.query(func.count(Tecnico.id)).filter(Tecnico.tenant_id == tenant_id).scalar() or 0
    tecnici_disp  = db.query(func.count(Tecnico.id)).filter(Tecnico.tenant_id == tenant_id, Tecnico.stato == "in servizio").scalar() or 0

    ticket_counts = dict(
        db.query(Ticket.stato, func.count(Ticket.id))
        .filter(Ticket.tenant_id == tenant_id)
        .group_by(Ticket.stato)
        .all()
    )

    # Aree disponibili — usate dal frontend per il filtro (evita la chiamata extra limit=1000)
    areas = sorted(
        r[0] for r in
        db.query(distinct(Asset.area)).filter(Asset.tenant_id == tenant_id, Asset.area.isnot(None)).all()
        if r[0]
    )

    return {
        "assets": total_assets,
        "asset_stati": asset_stati,
        "tecnici": tecnici_total,
        "tecnici_disponibili": tecnici_disp,
        "ticket_aperti":     ticket_counts.get("Aperto", 0),
        "ticket_pianificati": ticket_counts.get("Pianificato", 0),
        "ticket_in_corso":   ticket_counts.get("In corso", 0),
        "ticket_chiusi":     ticket_counts.get("Chiuso", 0),
        "areas": areas,
    }


@router.get("/dashboard/kpi-asset")
def dashboard_kpi_asset(
    page: int = 1,
    limit: int = 10,
    area: str | None = None,
    search: str | None = None,
    stato: str | None = None,
    # Filtri granulari colonna
    sito: str | None = None,
    codice: str | None = None,
    asset_name: str | None = None,
    asset_area: str | None = None,
    asset_stato: str | None = None,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=30)

    # ── Filtra asset ─────────────────────────────────────────────────────────
    q = db.query(Asset).filter(Asset.tenant_id == tenant_id)
    if area:
        q = q.filter(Asset.area == area)
    if search:
        q = q.filter((Asset.nome.ilike(f"%{search}%")) | (Asset.codice.ilike(f"%{search}%")))
    if stato:
        q = q.filter(Asset.stato == stato)
        
    # Filtri colonna specifici
    if codice:
        q = q.filter(Asset.codice.ilike(f"%{codice}%"))
    if asset_name:
        q = q.filter(Asset.nome.ilike(f"%{asset_name}%"))
    if asset_area:
        q = q.filter(Asset.area.ilike(f"%{asset_area}%"))
    if asset_stato:
        q = q.filter(Asset.stato.ilike(f"%{asset_stato}%"))
    if sito:
        # Sito richiede join
        q = q.join(Asset.impianto).join(Impianto.sito).filter(Sito.nome.ilike(f"%{sito}%"))

    total = q.count()
    assets = (
        q.options(joinedload(Asset.impianto).joinedload(Impianto.sito))
        .order_by(Asset.nome)
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    if not assets:
        return {"assets": [], "total": total, "page": page, "pages": 0,
                "aggregati": {"avg_mtbf_giorni": 0.0, "avg_oee_pct": 0.0}}

    asset_ids = [a.id for a in assets]

    # ── Una sola query batch per tutti i ticket degli asset a pagina ──────────
    ticket_agg = (
        db.query(
            Ticket.asset_id,
            # guasti totali (CM o BD)
            func.count(Ticket.id).filter(Ticket.tipo.in_(["CM", "BD"])).label("n_guasti"),
            # downtime da ticket CHIUSI negli ultimi 30gg
            func.coalesce(
                func.sum(
                    case(
                        (
                            (Ticket.tipo.in_(["CM", "BD"]))
                            & (Ticket.stato == "Chiuso")
                            & (Ticket.execution_finish >= cutoff),
                            func.coalesce(Ticket.durata_stimata_ore, 1.0),
                        ),
                        else_=0.0,
                    )
                ),
                0.0,
            ).label("downtime_chiusi"),
            # downtime da ticket APERTI / IN CORSO creati negli ultimi 30gg
            func.coalesce(
                func.sum(
                    case(
                        (
                            (Ticket.stato.in_(["Aperto", "In corso"]))
                            & (Ticket.created_at >= cutoff),
                            func.coalesce(Ticket.durata_stimata_ore, 1.0),
                        ),
                        else_=0.0,
                    )
                ),
                0.0,
            ).label("downtime_aperti"),
        )
        .filter(Ticket.asset_id.in_(asset_ids), Ticket.tenant_id == tenant_id)
        .group_by(Ticket.asset_id)
        .all()
    )

    stats = {row.asset_id: row for row in ticket_agg}

    # ── Costruisci KPI per asset ───────────────────────────────────────────────
    kpi_list = []
    total_mtbf = 0.0
    total_oee  = 0.0

    for a in assets:
        row = stats.get(a.id)
        n_guasti        = row.n_guasti        if row else 0
        downtime_chiusi = float(row.downtime_chiusi) if row else 0.0
        downtime_aperti = float(row.downtime_aperti) if row else 0.0

        # MTBF
        if a.created_at:
            start = a.created_at if a.created_at.tzinfo else a.created_at.replace(tzinfo=timezone.utc)
        elif a.anno:
            start = datetime(a.anno, 1, 1, tzinfo=timezone.utc)
        else:
            start = now - timedelta(days=365)
        total_days = max(0.1, (now - start).total_seconds() / 86400)
        mtbf = round(total_days / max(n_guasti, 1), 1)

        # OEE / availability (ultimi 30gg)
        downtime_ongoing = 0.0
        asset_stato = _asset_stato_key(a.stato)
        if asset_stato == "out of service" and a.stato_changed_at:
            ts = a.stato_changed_at if a.stato_changed_at.tzinfo else a.stato_changed_at.replace(tzinfo=timezone.utc)
            start_event = max(ts, cutoff)
            downtime_ongoing = max(0.0, (now - start_event).total_seconds() / 3600)

        total_downtime = downtime_chiusi + downtime_aperti + downtime_ongoing
        availability = max(0.0, min(1.0, (TEMPO_PROGRAMMATO_H - total_downtime) / TEMPO_PROGRAMMATO_H))
        oee = round(availability * 100, 1)

        # Downtime ticker per asset OoS
        stato_changed_at_iso = None
        downtime_seconds = None
        if a.stato_changed_at:
            ts = a.stato_changed_at if a.stato_changed_at.tzinfo else a.stato_changed_at.replace(tzinfo=timezone.utc)
            stato_changed_at_iso = ts.isoformat()
            if asset_stato == "out of service":
                downtime_seconds = int((now - ts).total_seconds())

        kpi_list.append({
            "asset_id":        a.id,
            "asset_sito":      a.impianto.sito.nome if a.impianto and a.impianto.sito else "",
            "asset_nome":      a.nome,
            "asset_codice":    a.codice or "",
            "asset_area":      a.area or "",
            "stato":           asset_stato,
            "stato_changed_at": stato_changed_at_iso,
            "downtime_seconds": downtime_seconds,
            "mtbf_giorni":     mtbf,
            "oee_pct":         oee,
            "n_guasti":        n_guasti,
            "downtime_ore_30gg": round(total_downtime, 1),
        })

        total_mtbf += mtbf
        total_oee  += oee

    n = len(kpi_list)
    return {
        "assets": kpi_list,
        "total":  total,
        "page":   page,
        "pages":  max(1, (total + limit - 1) // limit),
        "aggregati": {
            "avg_mtbf_giorni": round(total_mtbf / n, 1) if n else 0.0,
            "avg_oee_pct":     round(total_oee  / n, 1) if n else 0.0,
        },
    }


@router.get("/dashboard/charts")
def dashboard_charts(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    # Tutto via GROUP BY — niente caricamento in memoria
    def to_map(rows):
        return dict(rows)

    by_priority = to_map(
        db.query(Ticket.priorita, func.count(Ticket.id))
        .filter(Ticket.tenant_id == tenant_id)
        .group_by(Ticket.priorita).all()
    )
    by_status = to_map(
        db.query(Ticket.stato, func.count(Ticket.id))
        .filter(Ticket.tenant_id == tenant_id)
        .group_by(Ticket.stato).all()
    )
    by_fascia = to_map(
        db.query(Ticket.fascia_oraria, func.count(Ticket.id))
        .filter(Ticket.tenant_id == tenant_id)
        .group_by(Ticket.fascia_oraria).all()
    )
    by_tipo = to_map(
        db.query(Ticket.tipo, func.count(Ticket.id))
        .filter(Ticket.tenant_id == tenant_id)
        .group_by(Ticket.tipo).all()
    )
    by_stato_asset = to_map(
        db.query(Asset.stato, func.count(Asset.id))
        .filter(Asset.tenant_id == tenant_id)
        .group_by(Asset.stato).all()
    )

    return {
        "ticket_by_priority": [
            {"name": "Alta",  "value": by_priority.get("alta",  by_priority.get("Alta",  0))},
            {"name": "Media", "value": by_priority.get("media", by_priority.get("Media", 0))},
            {"name": "Bassa", "value": by_priority.get("bassa", by_priority.get("Bassa", 0))},
        ],
        "ticket_by_status": [
            {"name": "Aperto",      "value": by_status.get("Aperto", 0)},
            {"name": "Pianificato", "value": by_status.get("Pianificato", 0)},
            {"name": "In corso",    "value": by_status.get("In corso", 0)},
            {"name": "Chiuso",      "value": by_status.get("Chiuso", 0)},
        ],
        "ticket_by_fascia": [
            {"name": "Mattina",    "value": by_fascia.get("mattina",    by_fascia.get("Mattina",    0))},
            {"name": "Pomeriggio", "value": by_fascia.get("pomeriggio", by_fascia.get("Pomeriggio", 0))},
            {"name": "Notturna",   "value": by_fascia.get("notturna",   by_fascia.get("Notturna",   0))},
        ],
        "ticket_by_tipo": [
            {"name": "PM",  "value": by_tipo.get("PM",  0)},
            {"name": "CM",  "value": by_tipo.get("CM",  0)},
            {"name": "BD",  "value": by_tipo.get("BD",  0)},
            {"name": "ISP", "value": by_tipo.get("ISP", 0)},
        ],
        "asset_by_stato": [
            {"name": label, "value": value}
            for label, value in {
                _asset_stato_label(k): sum(cnt for raw, cnt in by_stato_asset.items() if _asset_stato_label(raw) == _asset_stato_label(k))
                for k in by_stato_asset.keys()
            }.items()
        ],
    }


@router.get("/dashboard/trends")
def dashboard_trends(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    today = date.today()
    labels = [(today - timedelta(days=i)).strftime("%d/%m") for i in range(6, -1, -1)]
    tickets = db.query(func.count(Ticket.id)).filter(
        Ticket.tenant_id == tenant_id, Ticket.stato != "Eliminato"
    ).scalar() or 0
    per_day = [max(0, tickets // 7 + (1 if i < tickets % 7 else 0)) for i in range(7)]
    return {"labels": labels, "values": per_day, "total": tickets}
