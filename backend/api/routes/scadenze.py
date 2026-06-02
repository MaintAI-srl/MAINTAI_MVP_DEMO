from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.db.modelli import AttivitaManutenzione, Asset, Ticket, PianoManutenzione
from backend.services.condition_maintenance_service import (
    latest_running_hours_by_asset,
    normalize_trigger_mode,
    task_due_summary,
)

router = APIRouter()


def _as_aware(dt: datetime | None) -> datetime | None:
    if not dt:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _compute_next_due(att: AttivitaManutenzione) -> datetime | None:
    if att.next_due_at:
        return _as_aware(att.next_due_at)
    if att.prossima_scadenza:
        return _as_aware(att.prossima_scadenza)
    if att.frequenza_giorni:
        base = _as_aware(att.last_generated_at) or _as_aware(att.ultima_esecuzione)
        if base:
            return base + timedelta(days=att.frequenza_giorni)
    return None


def _format_frequency(days: int | None) -> str:
    if not days:
        return ""
    if days % 365 == 0:
        years = days // 365
        return f"{years}A" if years > 1 else "12M"
    if days % 30 == 0:
        return f"{days // 30}M"
    if days % 7 == 0:
        return f"{days // 7}W"
    return f"{days}G"


def _ticket_label(ticket: Ticket | None, when: datetime | None = None) -> str:
    if not ticket and not when:
        return ""
    date_value = when
    if ticket and not date_value:
        date_value = ticket.execution_finish or ticket.planned_start or ticket.created_at
    date_part = date_value.date().isoformat() if date_value else ""
    if ticket:
        return f"ticket n° {ticket.id}" + (f" - {date_part}" if date_part else "")
    return f"da generare - {date_part}" if date_part else "da generare"


def _task_type(att: AttivitaManutenzione) -> str:
    text = " ".join(
        str(v or "")
        for v in (att.source_type, att.origine, att.codice, att.nome, att.descrizione)
    ).lower()
    legal_markers = ("legge", "norma", "d.lgs", "dpr", "obblig", "verifica periodica")
    if any(marker in text for marker in legal_markers):
        return "LEGGE/PM"
    return "PM"


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
            # _as_aware: la colonna è TIMESTAMP WITHOUT TIME ZONE (naive); senza
            # normalizzazione il confronto con now (aware) solleva TypeError → 500
            "urgenza": "alta" if _as_aware(s.prossima_scadenza) <= now + timedelta(days=2) else "media"
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
            "urgenza": "alta" if _as_aware(a.prossima_scadenza) <= now + timedelta(days=3) else "media",
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
            "is_manual_plan": getattr(t, "is_manual_plan", False),
        }
        for t in pm_tickets
    ]

    return {"eventi": eventi_attivita + eventi_ticket, "mesi": mesi}


@router.get("/scadenze/scadenziario")
def get_scadenziario_piani(
    limit: int = Query(500, ge=1, le=1000),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Lista tabellare delle scadenze reali lette dai piani di manutenzione."""
    now = datetime.now(timezone.utc)

    tasks = (
        db.query(AttivitaManutenzione)
        .filter(
            AttivitaManutenzione.tenant_id == tenant_id,
            AttivitaManutenzione.piano_id.isnot(None),
            or_(AttivitaManutenzione.task_stato.is_(None), AttivitaManutenzione.task_stato != "archived"),
            or_(
                AttivitaManutenzione.prossima_scadenza.isnot(None),
                AttivitaManutenzione.next_due_at.isnot(None),
                AttivitaManutenzione.last_generated_at.isnot(None),
                AttivitaManutenzione.ultima_esecuzione.isnot(None),
                AttivitaManutenzione.condition_threshold_hours.isnot(None),
            ),
        )
        .order_by(AttivitaManutenzione.id.asc())
        .limit(limit)
        .all()
    )

    if not tasks:
        return {"items": [], "total": 0, "generated_at": now.isoformat()}

    piano_ids = {t.piano_id for t in tasks if t.piano_id}
    asset_ids = {t.asset_id for t in tasks if t.asset_id}
    task_ids = [t.id for t in tasks]

    piani = {
        p.id: p
        for p in db.query(PianoManutenzione).filter(
            PianoManutenzione.id.in_(piano_ids),
            PianoManutenzione.tenant_id == tenant_id,
        ).all()
    } if piano_ids else {}

    assets = {
        a.id: a
        for a in db.query(Asset).filter(
            Asset.id.in_(asset_ids),
            Asset.tenant_id == tenant_id,
        ).all()
    } if asset_ids else {}
    latest_readings = latest_running_hours_by_asset(db, tenant_id, asset_ids)

    tickets = (
        db.query(Ticket)
        .filter(
            Ticket.attivita_manutenzione_id.in_(task_ids),
            Ticket.tenant_id == tenant_id,
            Ticket.deleted_at.is_(None),
        )
        .order_by(Ticket.created_at.desc())
        .all()
    )

    closed_by_task: dict[int, Ticket] = {}
    active_by_task: dict[int, Ticket] = {}
    for ticket in tickets:
        task_id = ticket.attivita_manutenzione_id
        if not task_id:
            continue
        if ticket.stato in ("Aperto", "Pianificato", "In corso") and task_id not in active_by_task:
            active_by_task[task_id] = ticket
        if (ticket.stato == "Chiuso" or ticket.execution_finish) and task_id not in closed_by_task:
            closed_by_task[task_id] = ticket

    rows = []
    for task in tasks:
        summary = task_due_summary(task, latest_readings.get(task.asset_id), now)
        next_due = summary["effective_due_at"] or summary["calendar_due_at"]
        condition = summary["condition"]
        if not next_due and summary["trigger_mode"] == "condition":
            next_due = None
        if not next_due and condition.get("due_at_hours") is None:
            continue

        asset = assets.get(task.asset_id)
        piano = piani.get(task.piano_id)
        impianto = asset.impianto if asset else None
        sito = impianto.sito if impianto else None
        last_ticket = closed_by_task.get(task.id)
        next_ticket = active_by_task.get(task.id)

        days_remaining = (next_due.date() - now.date()).days if next_due else None
        rows.append({
            "id": task.id,
            "sito": sito.nome if sito else "",
            "impianto": impianto.nome if impianto else "",
            "asset": asset.nome if asset else "",
            "asset_id": task.asset_id,
            "piano": piano.nome_codificato if piano else "",
            "piano_id": task.piano_id,
            "task": task.nome or task.descrizione or "",
            "tipo": _task_type(task),
            "frequenza": _format_frequency(task.frequenza_giorni),
            "frequenza_giorni": task.frequenza_giorni,
            "ultima": _ticket_label(last_ticket),
            "ultima_ticket_id": last_ticket.id if last_ticket else None,
            "ultima_data": (
                (last_ticket.execution_finish or last_ticket.created_at).isoformat()
                if last_ticket and (last_ticket.execution_finish or last_ticket.created_at)
                else None
            ),
            "prossima": _ticket_label(next_ticket, next_due),
            "prossima_ticket_id": next_ticket.id if next_ticket else None,
            "prossima_data": next_due.isoformat() if next_due else None,
            "giorni_rimanenti": days_remaining,
            "priorita": task.priorita or "Media",
            "trigger_mode": normalize_trigger_mode(task.trigger_mode),
            "trigger_kind": summary["effective_kind"],
            "current_running_hours": condition.get("current_hours"),
            "condition_due_at_hours": condition.get("due_at_hours"),
            "condition_remaining_hours": condition.get("remaining_hours"),
            "condition_is_due": condition.get("is_due", False),
        })

    rows.sort(key=lambda row: (row["giorni_rimanenti"] if row["giorni_rimanenti"] is not None else 10**9, row["sito"], row["impianto"], row["asset"]))
    return {"items": rows, "total": len(rows), "generated_at": now.isoformat()}
