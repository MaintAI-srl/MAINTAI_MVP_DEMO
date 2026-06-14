"""
Auto Scheduler Bridge — Adattatore ORM ↔ motore deterministico `auto_scheduler`.

Converte:
  ORM (Ticket, Tecnico, Asset, TecnicoAssenza) → SchedTicket / SchedTechnician / CalendarBlock
  risultato auto_schedule_tickets()             → plan_json (compatibile col Gantt/conferma)
                                                  + scheduling_summary (KPI saturazione)

Uso:
  from backend.services.auto_scheduler_bridge import generate_auto_schedule_plan
  plan_json = await generate_auto_schedule_plan(db, days=7, tenant_id=1)

NB: motore 100% deterministico — nessuna chiamata AI.
"""
from __future__ import annotations

import logging
import math
from datetime import date as date_type, datetime, timedelta
from typing import Any, Dict, List, Optional

# Tetto di sicurezza all'auto-estensione dell'orizzonte (giorni di calendario).
# Evita orizzonti illimitati con backlog enormi pur "non fermandosi" ai 7 giorni.
MAX_HORIZON_CALENDAR_DAYS = 180

from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.db.modelli import Asset, AttivitaManutenzione, Tecnico, Ticket, TecnicoAssenza
from backend.services.adaptive_estimator import get_duration_correction_factor
from backend.services.ai_planner_service import calculate_plan_efficiency
from backend.services.planner_engine_bridge import (
    _build_assenze_map,
    _split_competenze,
    _TIPO_IMPLICITI,
)
from backend.services.auto_scheduler import (
    CalendarBlock,
    SchedTechnician,
    SchedTicket,
    auto_schedule_tickets,
    NON_SCHEDULABILE_DATI_MANCANTI,
    NON_SCHEDULABILE_MATERIALI,
    NON_SCHEDULABILE_SKILL_ASSENTE,
    NON_SCHEDULABILE_SLOT_ASSENTE,
    NON_SCHEDULABILE_STATO,
)
from backend.core.logger_db import db_info

logger = logging.getLogger(__name__)


# ── Traduzione reason code → italiano ─────────────────────────────────────────

REASON_IT: Dict[str, str] = {
    NON_SCHEDULABILE_DATI_MANCANTI: "Dati minimi mancanti (durata, sito/asset o skill richiesta)",
    NON_SCHEDULABILE_SKILL_ASSENTE: "Nessun tecnico con la skill richiesta disponibile",
    NON_SCHEDULABILE_SLOT_ASSENTE:  "Nessuno slot disponibile: tecnici al completo o non disponibili nell'orizzonte",
    NON_SCHEDULABILE_MATERIALI:     "Materiali non pronti (intervento bloccato)",
    NON_SCHEDULABILE_STATO:         "Stato ticket non compatibile con lo scheduling",
}


# ── Conversione ORM → strutture motore ────────────────────────────────────────

def _build_sched_technicians(
    tecnici: List[Tecnico],
    assenze_map: Dict[int, List[date_type]],
    workday_end_hour: int = 17,
) -> List[SchedTechnician]:
    """
    Converte i tecnici ORM in SchedTechnician.

    Ogni tecnico attivo riceve SEMPRE le competenze implicite PM/CM/BD: la
    manutenzione "generica" (ticket senza competenza_richiesta specifica, che usa
    il tipo come proxy) può essere svolta da qualsiasi tecnico. Le job-skill
    specifiche (Meccanico, Elettricista, ...) restano per i ticket che richiedono
    esplicitamente quella competenza. Questo evita che i ticket generici finiscano
    tutti su un solo tecnico lasciando vuoti quelli con job-skill.
    """
    result: List[SchedTechnician] = []
    for t in tecnici:
        if (t.stato or "").lower() not in ("in servizio", "in_servizio"):
            continue
        comp = _split_competenze(t.competenze)
        for tipo in _TIPO_IMPLICITI:
            if tipo not in comp:
                comp.append(tipo)

        orario_inizio = t.orario_inizio or "08:00"
        try:
            start_h = int(orario_inizio.split(":", 1)[0])
        except (ValueError, IndexError):
            start_h = 8
        # Overtime: estende la finestra di fine giornata (e quindi la capacità)
        if workday_end_hour > 17:
            orario_fine = f"{workday_end_hour:02d}:00"
            ore_giornaliere = max(t.ore_giornaliere or 8, workday_end_hour - start_h)
        else:
            orario_fine = t.orario_fine or "17:00"
            ore_giornaliere = t.ore_giornaliere or 8

        daily_cap = int(ore_giornaliere * 60)
        result.append(SchedTechnician(
            id=t.id,
            name=f"{t.nome} {t.cognome or ''}".strip(),
            skills=comp,
            workday_start=orario_inizio,
            workday_end=orario_fine,
            daily_capacity_minutes=daily_cap,
            weekly_capacity_minutes=daily_cap * 5,
            active=True,
            base_site_id=None,
            absent_days=assenze_map.get(t.id, []),
        ))
    return result


def _build_sched_tickets(
    tickets: List[Ticket],
    asset_map: Dict[int, Asset],
    db: Optional[Session],
    tenant_id: Optional[int],
    planning_start: date_type,
    scadenze_map: Optional[Dict[int, date_type]] = None,
) -> List[SchedTicket]:
    scadenze_map = scadenze_map or {}
    result: List[SchedTicket] = []
    for t in tickets:
        asset = asset_map.get(t.asset_id) if t.asset_id else None
        site_id: Optional[int] = asset.impianto_id if asset else None
        criticality: Optional[str] = getattr(asset, "criticita", None) if asset else None

        # Scadenziario: giorni alla prossima scadenza PM dell'asset (None = nessuna)
        deadline_days: Optional[int] = None
        scad = scadenze_map.get(t.asset_id) if t.asset_id else None
        if scad is not None:
            scad_date = scad.date() if isinstance(scad, datetime) else scad
            deadline_days = (scad_date - planning_start).days

        durata_base = float(t.durata_stimata_ore or 2.0)
        durata_corretta = durata_base
        if db is not None and tenant_id is not None:
            try:
                fattore = get_duration_correction_factor(
                    db=db,
                    ticket_tipo=t.tipo or "CM",
                    asset_id=t.asset_id,
                    tenant_id=tenant_id,
                )
                if abs(fattore - 1.0) > 0.05:
                    durata_corretta = round(durata_base * fattore, 2)
            except Exception as exc:  # pragma: no cover - best effort
                logger.warning("AutoScheduler: AdaptiveEstimator ticket #%s errore: %s", t.id, exc)

        eta_giorni = 0
        if t.created_at:
            created = t.created_at.date() if isinstance(t.created_at, datetime) else t.created_at
            eta_giorni = max(0, (planning_start - created).days)

        # required_skill: competenza esplicita, altrimenti tipo come proxy
        required_skill = (t.competenza_richiesta or t.tipo or "CM").strip().upper()

        # Materiali: in_attesa_ricambio → materiali necessari ma non pronti
        in_attesa = bool(getattr(t, "in_attesa_ricambio", False))

        result.append(SchedTicket(
            id=t.id,
            title=t.titolo or f"Ticket #{t.id}",
            site_id=site_id,
            asset_id=t.asset_id,
            status=t.stato or "Aperto",
            required_skill=required_skill,
            estimated_duration_minutes=int(round(durata_corretta * 60)),
            priority=t.priorita or "Media",
            asset_criticality=criticality,
            materials_ready=not in_attesa,
            materials_required=in_attesa,
            age_days=eta_giorni,
            deadline_days=deadline_days,
        ))
    return result


def _build_locked_blocks(locked_tickets: List[Ticket]) -> List[CalendarBlock]:
    """Ticket già pianificati/manuali → blocchi calendario CONFIRMED (occupano capacità)."""
    blocks: List[CalendarBlock] = []
    for t in locked_tickets:
        if not t.tecnico_id or not t.planned_start:
            continue
        start = t.planned_start if isinstance(t.planned_start, datetime) else datetime.combine(t.planned_start, datetime.min.time())
        if t.planned_finish:
            end = t.planned_finish if isinstance(t.planned_finish, datetime) else datetime.combine(t.planned_finish, datetime.min.time())
        else:
            end = start + timedelta(hours=float(t.durata_stimata_ore or 2.0))
        blocks.append(CalendarBlock(
            technician_id=t.tecnico_id,
            ticket_id=t.id,
            start=start,
            end=end,
            duration_minutes=int(round((end - start).total_seconds() / 60.0)),
            type="TICKET",
            source="MANUAL",
            status="CONFIRMED",
        ))
    return blocks


# ── Bridge principale ─────────────────────────────────────────────────────────

async def generate_auto_schedule_plan(
    db: Session,
    days: int = 7,
    asset_ids: Optional[List[int]] = None,
    tenant_id: Optional[int] = None,
    start_date: Optional[date_type] = None,
    include_weekends: bool = False,
    workday_end_hour: int = 17,
    enforce_skill: Optional[bool] = None,
    enforce_materials: Optional[bool] = None,
) -> Dict[str, Any]:
    """
    Genera un piano con il motore di auto-scheduling deterministico (saturazione ore).
    Ritorna plan_json compatibile col formato esistente + chiave scheduling_summary.

    enforce_skill / enforce_materials: se None, vengono letti dalle env
    SCHEDULER_ENFORCE_SKILL / SCHEDULER_ENFORCE_MATERIALS (default "false" → demo:
    non si blocca la pianificazione per skill o materiali). Impostare le env a
    "true" per riattivare i vincoli in produzione.
    """
    import os
    if enforce_skill is None:
        enforce_skill = os.getenv("SCHEDULER_ENFORCE_SKILL", "false").lower() == "true"
    if enforce_materials is None:
        enforce_materials = os.getenv("SCHEDULER_ENFORCE_MATERIALS", "false").lower() == "true"

    today = start_date or date_type.today()
    horizon_end = today + timedelta(days=days - 1)

    # ── Ticket locked (già pianificati o manuali) ─────────────────────────────
    locked_query = db.query(Ticket).filter(
        or_(
            Ticket.tecnico_id.isnot(None) & Ticket.planned_start.isnot(None),
            Ticket.is_manual_plan.is_(True),
        )
    )
    if tenant_id:
        locked_query = locked_query.filter(Ticket.tenant_id == tenant_id)
    locked_tickets = locked_query.all()
    locked_ids = {t.id for t in locked_tickets}

    # ── Ticket pianificabili (Aperto / Pianificato non assegnato) ─────────────
    ticket_query = db.query(Ticket).filter(
        Ticket.stato.in_(["Aperto", "Pianificato"]),
        Ticket.deleted_at.is_(None),
    )
    if locked_ids:
        ticket_query = ticket_query.filter(~Ticket.id.in_(locked_ids))
    if tenant_id:
        ticket_query = ticket_query.filter(Ticket.tenant_id == tenant_id)
    if asset_ids:
        ticket_query = ticket_query.filter(Ticket.asset_id.in_(asset_ids))
    tickets = ticket_query.all()

    # ── Tecnici attivi ────────────────────────────────────────────────────────
    tecnico_query = db.query(Tecnico).filter(Tecnico.stato.in_(["in servizio", "in_servizio"]))
    if tenant_id:
        tecnico_query = tecnico_query.filter(Tecnico.tenant_id == tenant_id)
    tecnici = tecnico_query.all()

    if not tickets:
        return _empty_plan("Nessun ticket aperto o pianificabile trovato nel sistema.")
    if not tecnici:
        return _empty_plan(
            "Nessun tecnico in servizio trovato nel sistema.",
            deferred=[{"wo_id": t.id, "reason": "Nessun tecnico disponibile in servizio"} for t in tickets],
        )

    # ── Auto-orizzonte: stima iniziale (verrà esteso se servono più giorni) ────
    # Il pianificatore non si ferma a una finestra fissa: dimensiona l'orizzonte
    # sul backlog (durata totale / capacità giornaliera dei tecnici) e poi lo
    # estende finché tutto il backlog schedulabile entra (vedi loop più sotto),
    # fino a un tetto di sicurezza.
    total_minutes_est = sum(int(round(float(t.durata_stimata_ore or 2.0) * 60)) for t in tickets)
    daily_cap_total = sum(int((t.ore_giornaliere or 8) * 60) for t in tecnici) or 1
    working_days_needed = math.ceil(total_minutes_est / daily_cap_total) + 1
    # 5 giorni lavorativi per settimana → converti in giorni di calendario + buffer
    calendar_needed = math.ceil(working_days_needed * 7 / 5) + 4
    effective_days = min(MAX_HORIZON_CALENDAR_DAYS, max(days, calendar_needed))
    horizon_end = today + timedelta(days=effective_days - 1)
    # Le assenze vengono caricate sull'intero orizzonte MASSIMO possibile, così le
    # estensioni successive non devono ri-interrogare il DB.
    max_horizon_end = today + timedelta(days=MAX_HORIZON_CALENDAR_DAYS - 1)

    # ── Assenze (su tutto l'orizzonte massimo) ────────────────────────────────
    tecnico_ids = [t.id for t in tecnici]
    assenze_q = db.query(TecnicoAssenza).filter(
        TecnicoAssenza.tecnico_id.in_(tecnico_ids),
        TecnicoAssenza.data_fine >= today,
        TecnicoAssenza.data_inizio <= max_horizon_end,
    )
    if tenant_id:
        assenze_q = assenze_q.filter(TecnicoAssenza.tenant_id == tenant_id)
    assenze_map = _build_assenze_map(assenze_q.all(), today, max_horizon_end)

    # ── Asset map (criticità + sito) ──────────────────────────────────────────
    asset_id_set = list({t.asset_id for t in tickets if t.asset_id})
    asset_q = db.query(Asset).filter(Asset.id.in_(asset_id_set)) if asset_id_set else None
    if asset_q is not None and tenant_id:
        asset_q = asset_q.filter(Asset.tenant_id == tenant_id)
    assets = asset_q.all() if asset_q is not None else []
    asset_map: Dict[int, Asset] = {a.id: a for a in assets}

    # ── Scadenziario: prossima scadenza PM per asset (la più imminente) ────────
    scadenze_map: Dict[int, date_type] = {}
    if asset_id_set:
        scad_q = db.query(
            AttivitaManutenzione.asset_id,
            AttivitaManutenzione.prossima_scadenza,
        ).filter(
            AttivitaManutenzione.asset_id.in_(asset_id_set),
            AttivitaManutenzione.prossima_scadenza.isnot(None),
        )
        if tenant_id:
            scad_q = scad_q.filter(AttivitaManutenzione.tenant_id == tenant_id)
        for asset_id, prossima in scad_q.order_by(AttivitaManutenzione.prossima_scadenza.asc()).all():
            if asset_id not in scadenze_map:
                scadenze_map[asset_id] = prossima

    # ── Conversione ──────────────────────────────────────────────────────────
    sched_techs = _build_sched_technicians(tecnici, assenze_map, workday_end_hour=workday_end_hour)
    sched_tickets = _build_sched_tickets(
        tickets, asset_map, db=db, tenant_id=tenant_id, planning_start=today, scadenze_map=scadenze_map,
    )
    locked_blocks = _build_locked_blocks(locked_tickets)

    if not sched_techs:
        return _empty_plan(
            "Nessun tecnico con stato 'in servizio' trovato.",
            deferred=[{"wo_id": t.id, "reason": "Nessun tecnico attivo trovato"} for t in tickets],
        )

    # Nota: non logghiamo valori provenienti direttamente dalla request (days,
    # include_weekends) per evitare log-injection; usiamo solo conteggi interi.
    logger.info(
        "AutoScheduler: avvio — %d ticket, %d locked, %d tecnici (orizzonte iniziale %d gg)",
        len(sched_tickets), len(locked_blocks), len(sched_techs), int(effective_days),
    )

    # ── Scheduling con auto-estensione dell'orizzonte ─────────────────────────
    # Se restano ticket non pianificati per mancanza di SLOT (capacità), si
    # raddoppia l'orizzonte e si ripianifica, finché il backlog schedulabile è
    # esaurito o si raggiunge il tetto. Le esclusioni per skill/dati/materiali NON
    # si risolvono estendendo l'orizzonte: in quei casi si interrompe subito.
    result = None
    try:
        for _ in range(8):  # max 8 estensioni (2^8 copre ampiamente il tetto)
            result = auto_schedule_tickets(
                tickets=sched_tickets,
                technicians=sched_techs,
                calendar_blocks=locked_blocks,
                start_date=today,
                end_date=horizon_end,
                include_weekends=include_weekends,
                enforce_skill=enforce_skill,
                enforce_materials=enforce_materials,
            )
            slot_deferred = sum(
                1 for e in result["excluded"]
                if e["reason"] == NON_SCHEDULABILE_SLOT_ASSENTE
            )
            if slot_deferred == 0 or effective_days >= MAX_HORIZON_CALENDAR_DAYS:
                break
            effective_days = min(MAX_HORIZON_CALENDAR_DAYS, effective_days * 2)
            horizon_end = today + timedelta(days=effective_days - 1)
    except Exception as exc:
        logger.error("AutoScheduler: eccezione durante l'esecuzione: %s", exc, exc_info=True)
        return {"error": f"Errore motore auto-scheduling: {exc}"}

    logger.info(
        "AutoScheduler: completato — %d schedulati, %d esclusi (orizzonte %d gg)",
        len(result["assignments"]), len(result["excluded"]), int(effective_days),
    )

    # ── Converti assignments → planned_workorders ─────────────────────────────
    ticket_tipo_map = {t.id: (t.tipo or "CM") for t in tickets}
    planned_workorders: List[Dict[str, Any]] = []
    for a in result["assignments"]:
        start_dt = datetime.fromisoformat(a["start"])
        end_dt = datetime.fromisoformat(a["end"])
        duration_h = round(a["duration_minutes"] / 60.0, 2)
        confidence = round(min(1.0, 0.7 + a.get("score", 0) / 400.0), 3)
        risk = "LOW" if confidence >= 0.85 else "MEDIUM" if confidence >= 0.65 else "HIGH"
        complexity = "SIMPLE" if duration_h <= 2 else "COMPLEX" if duration_h > 8 else "STANDARD"
        planned_workorders.append({
            "wo_id":              a["ticket_id"],
            "technician_id":      a["technician_id"],
            "planned_date":       start_dt.date().isoformat(),
            "time_slot":          f"{start_dt.strftime('%H:%M')}-{end_dt.strftime('%H:%M')}",
            "planned_start_time": start_dt.strftime("%H:%M"),
            "planned_end_time":   end_dt.strftime("%H:%M"),
            "duration_hours":     duration_h,
            "motivation":         a.get("reason", "Assegnato dal motore di auto-scheduling"),
            "warnings":           [],
            "is_continuation":    False,
            "parent_wo_id":       None,
            "tipo":               ticket_tipo_map.get(a["ticket_id"], "CM"),
            "confidence_score":   confidence,
            "risk_level":         risk,
            "complexity":         complexity,
        })

    # ── Converti excluded → deferred_workorders ───────────────────────────────
    deferred_workorders: List[Dict[str, Any]] = []
    for e in result["excluded"]:
        code = e["reason"]
        deferred_workorders.append({
            "wo_id":       e["ticket_id"],
            "reason":      REASON_IT.get(code, code),
            "reason_code": code,
        })

    plan_json: Dict[str, Any] = {
        "planned_workorders":  planned_workorders,
        "deferred_workorders": deferred_workorders,
        "fermo_assets":        [],
        "global_warnings":     [],
        "scheduling_summary":  result["summary"],
    }

    # ── Efficiency score (per il badge esistente) ─────────────────────────────
    tecnici_data = [
        {"id": t.id, "ore_giornaliere": t.daily_capacity_minutes / 60.0}
        for t in sched_techs
    ]
    try:
        efficiency = calculate_plan_efficiency(
            plan_json,
            tecnici_data,
            total_backlog=len(tickets),
            plan_start_date=today,
            plan_end_date=horizon_end,
            absences=assenze_map,
            include_weekends=include_weekends,
        )
        plan_json["efficiency_score"] = efficiency["efficiency_score"]
        plan_json["efficiency_breakdown"] = efficiency["efficiency_breakdown"]
        plan_json["efficiency_motivations"] = efficiency.get("efficiency_motivations", [])
        plan_json["plan_metadata"] = {
            "ore_disponibili_teoriche": efficiency.get("ore_disponibili_teoriche"),
            "ore_disponibili_effettive": efficiency.get("ore_disponibili_effettive"),
            "ore_assegnate": efficiency.get("ore_assegnate"),
            "effective_days": effective_days,
        }
    except Exception as exc:  # pragma: no cover - best effort
        logger.warning("AutoScheduler: errore calcolo efficienza: %s", exc)
        plan_json["efficiency_score"] = 0
        plan_json["efficiency_breakdown"] = {}
        plan_json["efficiency_motivations"] = []
        plan_json["plan_metadata"] = {"effective_days": effective_days}

    if db is not None and tenant_id is not None:
        try:
            summary = result["summary"]
            db_info(
                db, "PLANNING",
                f"AutoScheduler: {summary.get('tickets_scheduled')} schedulati / "
                f"{summary.get('total_tickets_analyzed')} analizzati — "
                f"saturazione periodo {summary.get('utilization_percent')}%",
                tenant_id=tenant_id,
            )
        except Exception:  # pragma: no cover
            pass

    return plan_json


def _empty_plan(warning: str, deferred: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    return {
        "planned_workorders": [],
        "deferred_workorders": deferred or [],
        "fermo_assets": [],
        "global_warnings": [warning],
        "efficiency_score": 0,
        "efficiency_breakdown": {},
        "efficiency_motivations": [],
        "scheduling_summary": {
            "total_tickets_analyzed": len(deferred) if deferred else 0,
            "tickets_scheduled": 0,
            "tickets_excluded": len(deferred) if deferred else 0,
        },
    }
