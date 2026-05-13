"""
Router Planning — generazione, conferma, deautorizzazione e storico piani manutenzione.
"""
from __future__ import annotations

import time as _time
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Literal, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, field_validator
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.rate_limiter import limiter
from backend.core.security import get_current_tenant_id, get_current_user_payload
from backend.core.logging_config import get_logger
from backend.core.logger_db import db_info, db_error
from backend.db.modelli import GeneratedPlan, Ticket, Asset, Tecnico, Tenant, PlannerFeedback
from datetime import date as date_type
from backend.services.ai_planner_service import generate_ai_plan, calculate_plan_efficiency
from backend.services.planner_engine_bridge import generate_deterministic_plan
from backend.services.rolling_planner_engine import (
    run_rolling_analysis,
    RollingTicketInput,
    TecnicoInput,
)
from backend.services.opportunistic_service import find_opportunistic_suggestions

router = APIRouter(prefix="/planning", tags=["planning"])
logger = get_logger(__name__)

def _planning_today() -> date_type:
    """Data operativa del piano al momento della richiesta."""
    try:
        tz = ZoneInfo("Europe/Rome")
    except Exception:
        tz = datetime.now().astimezone().tzinfo
    return datetime.now(tz).date() + timedelta(days=1)


# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class GeneratePlanRequest(BaseModel):
    days: int = 7
    asset_ids: Optional[List[int]] = None
    mode: str = "auto"   # "deterministic" | "ai" | "auto"
    include_weekends: bool = False
    allow_overtime: bool = False

    @field_validator("days")
    @classmethod
    def validate_days(cls, v: int) -> int:
        if v < 1 or v > 90:
            raise ValueError("Il numero di giorni deve essere tra 1 e 90.")
        return v


class DeauthorizeRequest(BaseModel):
    reason: str

    @field_validator("reason")
    @classmethod
    def reason_not_empty(cls, v: str) -> str:
        if len(v.strip()) < 10:
            raise ValueError("Il motivo di deautorizzazione deve avere almeno 10 caratteri.")
        return v.strip()


class MoveTicketRequest(BaseModel):
    ticket_id: int
    new_date: Optional[str] = None         # "YYYY-MM-DD" — None = mantieni data corrente
    new_start_hour: Optional[int] = None   # 0-23 — None = mantieni orario corrente
    new_start_minute: Optional[int] = None # 0 o 30 — None = mantieni orario corrente
    tecnico_id: Optional[int] = None       # None = mantieni tecnico corrente


def _wo_count(plan: GeneratedPlan) -> int:
    """Conta i ticket pianificati (non le continuazioni)."""
    if not plan.plan_json:
        return 0
    wos = plan.plan_json.get("planned_workorders", [])
    return len([w for w in wos if not w.get("is_continuation", False)])


def _wo_ids_principali(plan: GeneratedPlan) -> List[int]:
    """Restituisce la lista di wo_id pianificati (escludendo continuazioni)."""
    if not plan.plan_json:
        return []
    return [
        w["wo_id"] for w in plan.plan_json.get("planned_workorders", [])
        if not w.get("is_continuation", False) and w.get("wo_id")
    ]


def _compute_scadenza(plan_json: dict) -> Optional[datetime]:
    """
    Calcola la scadenza del piano: data massima (planned_date) tra tutti i WO.
    Workaround: il modello non ha una deadline esplicita utente — viene derivata
    dall'ultimo giorno pianificato nel piano.
    """
    wos = plan_json.get("planned_workorders", [])
    dates = []
    for w in wos:
        interval = _planned_wo_interval(w)
        if interval:
            dates.append(interval[1])
    return max(dates) if dates else None


def _combine_plan_datetime(date_str: str, time_str: str) -> datetime:
    """Converte campi plan_json YYYY-MM-DD + HH:MM[/SS] in datetime."""
    t = (time_str or "").strip() or "08:00"
    if len(t.split(":")) == 2:
        t = f"{t}:00"
    return datetime.fromisoformat(f"{date_str}T{t}")


def _planned_wo_interval(wo: dict) -> Optional[tuple[datetime, datetime]]:
    """Estrae start/end da un workorder pianificato, con fallback su time_slot."""
    planned_date = wo.get("planned_date")
    if not planned_date:
        return None

    start_time = wo.get("planned_start_time")
    end_time = wo.get("planned_end_time")
    time_slot = wo.get("time_slot", "")
    if (not start_time or not end_time) and time_slot and "-" in time_slot:
        parts = time_slot.split("-", 1)
        start_time = start_time or parts[0].strip()
        end_time = end_time or parts[1].strip()

    try:
        start_dt = _combine_plan_datetime(planned_date, start_time or "08:00")
        end_dt = _combine_plan_datetime(planned_date, end_time or "17:00")
    except ValueError:
        return None

    if end_dt < start_dt:
        end_dt = end_dt + timedelta(days=1)
    return start_dt, end_dt


def _compute_completion_pct(plan: GeneratedPlan, db: Session) -> Optional[float]:
    """
    Percentuale di completamento del piano: ticket con stato 'Chiuso' / totale pianificati.
    Calcolata dinamicamente — non è un campo DB, ma un valore derivato dallo stato
    attuale dei ticket.
    Ritorna None se il piano non è confermato o non ha WO pianificati.
    """
    if plan.status not in ("confirmed", "deauthorized"):
        return None
    wo_ids = _wo_ids_principali(plan)
    if not wo_ids:
        return 0.0
    chiusi = db.query(func.count(Ticket.id)).filter(
        Ticket.id.in_(wo_ids),
        Ticket.stato == "Chiuso",
        Ticket.tenant_id == plan.tenant_id,
    ).scalar() or 0
    return round((chiusi / len(wo_ids)) * 100, 1)


def _batch_completion_pct(plans: List[GeneratedPlan], db: Session) -> Dict[int, Optional[float]]:
    """
    Calcola completion_pct per una lista di piani con una sola query DB invece di N.
    Raggruppa tutti i wo_ids dei piani eleggibili, esegue un COUNT per ticket_id,
    poi distribuisce i conteggi per piano.

    Usato in get_plan_history per evitare N+1 queries.
    """
    # Piano → lista di wo_ids (solo piani che meritano il calcolo)
    plan_wo_map: Dict[int, List[int]] = {}
    for p in plans:
        if p.status in ("confirmed", "deauthorized"):
            wo_ids = _wo_ids_principali(p)
            if wo_ids:
                plan_wo_map[p.id] = wo_ids

    if not plan_wo_map:
        return {p.id: None for p in plans}

    # Tutti gli id univoci da cercare
    all_wo_ids = list({wid for ids in plan_wo_map.values() for wid in ids})

    tenant_ids = list({p.tenant_id for p in plans if p.tenant_id})
    chiusi_rows = db.query(Ticket.id).filter(
        Ticket.id.in_(all_wo_ids),
        Ticket.stato == "Chiuso",
        Ticket.tenant_id.in_(tenant_ids) if tenant_ids else True,
    ).all()
    chiusi_set = {row[0] for row in chiusi_rows}

    result: Dict[int, Optional[float]] = {}
    for p in plans:
        wo_ids = plan_wo_map.get(p.id)
        if wo_ids is None:
            # draft o nessun WO
            result[p.id] = None if p.status == "draft" else 0.0
        else:
            n_chiusi = sum(1 for wid in wo_ids if wid in chiusi_set)
            result[p.id] = round((n_chiusi / len(wo_ids)) * 100, 1)
    return result


def _validate_and_fix_plan(
    plan_json: dict,
    technicians: list,
    start_date: date_type,
    end_date: date_type,
    include_weekends: bool = False,
) -> dict:
    """
    Rimuove WO invalidi dal piano generato dall'AI (#10).
    Controlla: tecnico/data mancanti, date fuori orizzonte, overflow ore giornaliere.
    Sposta i WO invalidati in deferred con reason_code VALIDATION_ERROR.
    """
    raw_score = plan_json.get("efficiency_score")
    if raw_score is not None:
        try:
            plan_json["efficiency_score"] = max(0, min(100, float(raw_score)))
        except (TypeError, ValueError):
            plan_json["efficiency_score"] = 0

    planned = plan_json.get("planned_workorders", [])
    valid = []
    invalid_wo_ids = []

    # Traccia slot per tecnico per giorno: (tech_id, date_str) → ore usate
    tech_slots: dict = {}

    for wo in planned:
        tech_id = wo.get("technician_id")
        if tech_id is None:
            logger.warning("_validate_and_fix_plan: technician_id None per wo_id=%s", wo.get("wo_id"))
        wo_date_str = wo.get("planned_date")
        raw_dur = wo.get("duration_hours", 0)
        try:
            duration = float(raw_dur)
        except (TypeError, ValueError):
            duration = 0.0
        if duration <= 0:
            duration = 1.0
            wo["duration_hours"] = 1.0

        if not tech_id or not wo_date_str:
            invalid_wo_ids.append(wo.get("wo_id"))
            continue

        try:
            wo_date = date_type.fromisoformat(wo_date_str)
        except (ValueError, TypeError):
            invalid_wo_ids.append(wo.get("wo_id"))
            continue

        if wo_date < start_date or wo_date > end_date:
            invalid_wo_ids.append(wo.get("wo_id"))
            continue
        if not include_weekends and wo_date.weekday() >= 5:
            invalid_wo_ids.append(wo.get("wo_id"))
            continue

        key = (tech_id, wo_date_str)
        ore_usate = tech_slots.get(key, 0.0)
        tech = next((t for t in technicians if t.get("id") == tech_id), None)
        ore_max = float(tech.get("ore_giornaliere", 8)) if tech else 8.0

        if ore_usate + duration > ore_max + 0.5:  # tolleranza 30min
            invalid_wo_ids.append(wo.get("wo_id"))
            continue

        tech_slots[key] = ore_usate + duration
        valid.append(wo)

    if invalid_wo_ids:
        deferred = plan_json.get("deferred_workorders", [])
        for wo_id in invalid_wo_ids:
            if wo_id is not None:
                deferred.append({
                    "wo_id": wo_id,
                    "reason": "WO rimosso dalla validazione: slot non valido o fuori orizzonte",
                    "reason_code": "VALIDATION_ERROR",
                })
        plan_json["deferred_workorders"] = deferred
        plan_json["global_warnings"] = plan_json.get("global_warnings", []) + [
            f"{len(invalid_wo_ids)} WO rimossi dalla validazione post-generazione AI"
        ]

    plan_json["planned_workorders"] = valid
    return plan_json


def _plan_to_dict(plan: GeneratedPlan, completion_pct: Optional[float] = None) -> dict:
    """Serializza un GeneratedPlan includendo tutti i campi storico."""
    pn = plan.plan_number
    return {
        "id": plan.id,
        "plan_number": pn,
        "plan_label": f"PIANO-{pn:03d}" if pn else None,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
        "status": plan.status,
        "horizon_days": plan.horizon_days,
        "plan_json": plan.plan_json or {},
        "confirmed_at": plan.confirmed_at.isoformat() if plan.confirmed_at else None,
        "confirmed_by": plan.confirmed_by,
        "scadenza": plan.scadenza.isoformat() if plan.scadenza else None,
        "deauthorized_at": plan.deauthorized_at.isoformat() if plan.deauthorized_at else None,
        "deauthorized_by": plan.deauthorized_by,
        "deauthorization_reason": plan.deauthorization_reason,
        "wo_count": _wo_count(plan),
        "tenant_id": plan.tenant_id,
        "efficiency_score": (plan.plan_json or {}).get("efficiency_score"),
        "completion_pct": completion_pct,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generate")
@limiter.limit("10/minute")
async def generate_plan(
    request: Request,
    data: GeneratePlanRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Genera un piano AI e lo salva come draft."""
    # ── FEATURE FLAG: Generazione AI disattivata ─────────────────────────────
    # Riattivare rimuovendo questo blocco o impostando AI_PLANNING_ENABLED=true
    import os
    if os.getenv("AI_PLANNING_ENABLED", "false").lower() != "true":
        raise HTTPException(
            status_code=503,
            detail="La generazione AI del piano è temporaneamente disattivata.",
        )
    # ── FINE FEATURE FLAG ────────────────────────────────────────────────────
    import os
    has_openai = bool(os.getenv("OPENAI_API_KEY", "").strip())
    planning_start_date = _planning_today()

    # Risolvi mode "auto": deterministico se no OpenAI key, AI altrimenti
    effective_mode = data.mode
    if effective_mode == "auto":
        effective_mode = "ai" if has_openai else "deterministic"

    logger.info(
        "Planning: avvio generazione — mode=%s days=%s tenant=%s",
        effective_mode, data.days, tenant_id,
    )
    db_info("PLANNING", f"Avvio generazione piano [{effective_mode}] — orizzonte {data.days}gg", tenant_id=tenant_id)

    t_gen_start = _time.monotonic()
    try:
        if effective_mode == "deterministic":
            plan_json = await generate_deterministic_plan(
                db=db,
                days=data.days,
                asset_ids=data.asset_ids,
                tenant_id=tenant_id,
                start_date=planning_start_date,
                include_weekends=data.include_weekends,
                workday_end_hour=21 if data.allow_overtime else 17,
            )
            if "error" in plan_json:
                msg = plan_json["error"]
                db_error("PLANNING", f"Errore motore deterministico: {msg}", tenant_id=tenant_id)
                raise HTTPException(status_code=500, detail=f"Errore motore deterministico: {msg}")
        else:
            plan_json = await generate_ai_plan(
                db=db,
                days=data.days,
                asset_ids=data.asset_ids,
                tenant_id=tenant_id,
                start_date=planning_start_date,
                include_weekends=data.include_weekends,
                workday_end_hour=21 if data.allow_overtime else 17,
            )
            if "error" in plan_json:
                msg = plan_json["error"]
                db_error("PLANNING", f"Errore motore AI: {msg}", tenant_id=tenant_id)
                raise HTTPException(status_code=500, detail=f"Errore motore AI: {msg}")

            # Validazione post-generazione AI (#10)
            tecnici_for_validation = db.query(Tecnico).filter(
                Tecnico.tenant_id == tenant_id,
                Tecnico.stato.in_(["in servizio", "in_servizio"]),
            ).all()
            effective_hours = 13 if data.allow_overtime else 8
            tecnici_data_v = [{"id": t.id, "ore_giornaliere": max(t.ore_giornaliere or 8, effective_hours)} for t in tecnici_for_validation]
            start_d = planning_start_date
            end_d = start_d + timedelta(days=data.days - 1)
            plan_json = _validate_and_fix_plan(plan_json, tecnici_data_v, start_d, end_d, include_weekends=data.include_weekends)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Planning: eccezione non gestita — %s", exc, exc_info=True)
        db_error("PLANNING", f"Eccezione durante generazione piano: {exc}", tenant_id=tenant_id)
        raise HTTPException(status_code=500, detail=f"Errore interno: {exc}")

    # Aggiungi plan_metadata al piano generato
    gen_ms = round((_time.monotonic() - t_gen_start) * 1000)
    conf_scores = [
        w.get("confidence_score")
        for w in plan_json.get("planned_workorders", [])
        if not w.get("is_continuation") and w.get("confidence_score") is not None
    ]
    confidence_avg = round(sum(conf_scores) / len(conf_scores), 3) if conf_scores else None
    plan_json.setdefault("plan_metadata", {}).update({
        "engine_version": "3.0",
        "generated_by": effective_mode,
        "generation_time_ms": gen_ms,
        "confidence_avg": confidence_avg,
        "planning_start_date": planning_start_date.isoformat(),
        "planning_end_date": (planning_start_date + timedelta(days=data.days - 1)).isoformat(),
        "include_weekends": data.include_weekends,
        "workday_end_hour": 21 if data.allow_overtime else 17,
    })

    # Recupera score del piano confermato precedente per confronto nel frontend
    previous_confirmed = db.query(GeneratedPlan).filter(
        GeneratedPlan.tenant_id == tenant_id,
        GeneratedPlan.status == "confirmed",
    ).order_by(GeneratedPlan.id.desc()).first()
    previous_score: Optional[float] = None
    if previous_confirmed and previous_confirmed.plan_json:
        previous_score = previous_confirmed.plan_json.get("efficiency_score")

    new_plan = GeneratedPlan(
        status="draft",
        horizon_days=data.days,
        plan_json=plan_json,
        tenant_id=tenant_id,
    )
    db.add(new_plan)
    db.commit()
    db.refresh(new_plan)

    n_wo = len(plan_json.get("planned_workorders", []))
    n_def = len(plan_json.get("deferred_workorders", []))
    new_score = plan_json.get("efficiency_score")
    logger.info(
        "Planning [%s]: piano generato — id=%s WO=%s rimandati=%s score=%s",
        effective_mode, new_plan.id, n_wo, n_def, new_score,
    )
    db_info(
        "PLANNING",
        f"Piano #{new_plan.id} generato [{effective_mode}] — {n_wo} pianificati, {n_def} rimandati",
        extra={"efficiency_score": new_score},
        tenant_id=tenant_id,
    )

    result = _plan_to_dict(new_plan)
    # Campi extra per confronto AI vs piano manuale/precedente (usati dal frontend)
    if previous_score is not None:
        result["previous_efficiency_score"] = previous_score
        result["score_improved"] = (new_score or 0) >= previous_score
    return result


@router.post("/move-ticket")
def move_ticket_in_plan(
    data: MoveTicketRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Sposta un ticket pianificato a una nuova data/ora (e/o nuovo tecnico).

    Chain-shift: se il ticket spostato si sovrappone ad altri ticket dello stesso
    tecnico nella stessa giornata, questi vengono traslati in avanti automaticamente.

    Aggiorna anche il plan_json dell'ultimo piano (draft o confirmed) per mantenere
    la coerenza tra DB ticket e piano visualizzato.

    Multi-tenancy: opera solo su ticket del tenant corrente.
    """
    ticket = db.query(Ticket).filter(
        Ticket.id == data.ticket_id,
        Ticket.tenant_id == tenant_id,
        Ticket.deleted_at.is_(None),
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail=f"Ticket {data.ticket_id} non trovato")

    # Calcola nuovi planned_start / planned_finish
    current_start = ticket.planned_start
    current_finish = ticket.planned_finish

    if current_start and current_finish:
        duration = current_finish - current_start
    else:
        # Fallback su durata_stimata_ore se i campi sono null
        dur_h = ticket.durata_stimata_ore or 2.0
        duration = timedelta(hours=float(dur_h))

    # Risolvi nuova data
    if data.new_date:
        try:
            new_d = datetime.strptime(data.new_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail=f"Formato data non valido: {data.new_date}")
    elif current_start:
        new_d = current_start.date()
    else:
        from datetime import date as date_type
        new_d = date_type.today()

    # Risolvi nuovo orario di inizio
    if data.new_start_hour is not None and data.new_start_minute is not None:
        new_start = datetime(new_d.year, new_d.month, new_d.day,
                             data.new_start_hour, data.new_start_minute)
    elif current_start:
        new_start = datetime(new_d.year, new_d.month, new_d.day,
                             current_start.hour, current_start.minute)
    else:
        new_start = datetime(new_d.year, new_d.month, new_d.day, 8, 0)

    new_finish = new_start + duration

    # Aggiorna tecnico se specificato
    new_tecnico_id = data.tecnico_id if data.tecnico_id is not None else ticket.tecnico_id

    # Aggiorna il ticket principale
    ticket.planned_start = new_start
    ticket.planned_finish = new_finish
    ticket.tecnico_id = new_tecnico_id
    if ticket.stato == "Aperto":
        ticket.stato = "Pianificato"

    updated_tickets = [{"id": ticket.id, "planned_start": new_start.isoformat(),
                         "planned_finish": new_finish.isoformat(), "tecnico_id": new_tecnico_id}]

    # ── Chain-shift: traslazione in avanti degli altri ticket sovrapposti ────
    if new_tecnico_id:
        day_start = datetime(new_d.year, new_d.month, new_d.day, 0, 0)
        day_end = day_start + timedelta(days=1)

        others = db.query(Ticket).filter(
            Ticket.tenant_id == tenant_id,
            Ticket.tecnico_id == new_tecnico_id,
            Ticket.id != data.ticket_id,
            Ticket.planned_start >= day_start,
            Ticket.planned_start < day_end,
            Ticket.stato == "Pianificato",
            Ticket.deleted_at.is_(None),
        ).order_by(Ticket.planned_start).all()

        current_end = new_finish
        for other in others:
            if other.planned_start is None:
                continue
            if other.planned_start < current_end:
                # Overlap: sposta in avanti
                other_dur = (
                    (other.planned_finish - other.planned_start)
                    if other.planned_start and other.planned_finish
                    else timedelta(hours=float(other.durata_stimata_ore or 2.0))
                )
                other.planned_start = current_end
                other.planned_finish = current_end + other_dur
                updated_tickets.append({
                    "id": other.id,
                    "planned_start": other.planned_start.isoformat(),
                    "planned_finish": other.planned_finish.isoformat(),
                    "tecnico_id": other.tecnico_id,
                })
                current_end = other.planned_finish

    # ── Aggiorna plan_json dell'ultimo piano del tenant ───────────────────────
    latest_plan = db.query(GeneratedPlan).filter(
        GeneratedPlan.tenant_id == tenant_id,
        GeneratedPlan.status.in_(["draft", "confirmed"]),
    ).order_by(GeneratedPlan.id.desc()).first()

    if latest_plan and latest_plan.plan_json:
        plan_j = dict(latest_plan.plan_json)  # copia shallow
        wos = list(plan_j.get("planned_workorders", []))
        updated_ids = {u["id"] for u in updated_tickets}

        for i, wo in enumerate(wos):
            wo_id = wo.get("wo_id")
            if wo_id not in updated_ids:
                continue
            u = next(u for u in updated_tickets if u["id"] == wo_id)
            ps = datetime.fromisoformat(u["planned_start"])
            pf = datetime.fromisoformat(u["planned_finish"])
            dur_h = (pf - ps).total_seconds() / 3600
            wos[i] = {
                **wo,
                "planned_date": ps.strftime("%Y-%m-%d"),
                "planned_start_time": ps.strftime("%H:%M"),
                "planned_end_time": pf.strftime("%H:%M"),
                "time_slot": f"{ps.strftime('%H:%M')}-{pf.strftime('%H:%M')}",
                "duration_hours": round(dur_h, 2),
                "technician_id": u["tecnico_id"] or wo.get("technician_id"),
            }

        plan_j["planned_workorders"] = wos
        latest_plan.plan_json = plan_j
        db.add(latest_plan)

    db.commit()

    logger.info(
        "move-ticket: ticket #%d spostato a %s %02d:%02d — %d ticket chain-shiftati",
        data.ticket_id, new_d, new_start.hour, new_start.minute,
        len(updated_tickets) - 1,
    )

    return {"updated_tickets": updated_tickets}


@router.post("/evaluate")
def evaluate_manual_plan(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Calcola l'efficiency_score del piano manuale corrente (ticket in stato Pianificato).
    Usa la stessa formula del motore AI per rendere i punteggi confrontabili.
    Utile per il pulsante 'Valutazione Piano' in modalità manuale.
    """
    from datetime import date as date_type

    planned_tickets = db.query(Ticket).filter(
        Ticket.tenant_id == tenant_id,
        Ticket.stato == "Pianificato",
        Ticket.deleted_at.is_(None),
    ).limit(500).all()

    open_tickets = db.query(Ticket).filter(
        Ticket.tenant_id == tenant_id,
        Ticket.stato == "Aperto",
        Ticket.deleted_at.is_(None),
    ).limit(500).all()

    tecnici = db.query(Tecnico).filter(
        Tecnico.tenant_id == tenant_id,
        Tecnico.stato == "in servizio",
    ).all()

    planned_wos = []
    for t in planned_tickets:
        if not t.tecnico_id:
            continue
        start_str = t.planned_start.strftime("%H:%M") if t.planned_start else "08:00"
        end_str = t.planned_finish.strftime("%H:%M") if t.planned_finish else "17:00"
        date_str = t.planned_start.strftime("%Y-%m-%d") if t.planned_start else str(date_type.today())
        dur = (
            (t.planned_finish - t.planned_start).total_seconds() / 3600
            if t.planned_start and t.planned_finish
            else (t.durata_stimata_ore or 2.0)
        )
        planned_wos.append({
            "wo_id": t.id,
            "technician_id": t.tecnico_id,
            "planned_date": date_str,
            "time_slot": f"{start_str}-{end_str}",
            "planned_start_time": start_str,
            "planned_end_time": end_str,
            "duration_hours": dur,
            "motivation": "Pianificazione manuale",
            "warnings": [],
            "is_continuation": getattr(t, "is_continuation", False) or False,
            "parent_wo_id": getattr(t, "parent_ticket_id", None),
            "tipo": t.tipo or "CM",
        })

    deferred_wos = [{"wo_id": t.id, "reason": "Non pianificato manualmente"} for t in open_tickets]

    plan_json_eval = {
        "planned_workorders": planned_wos,
        "deferred_workorders": deferred_wos,
        "fermo_assets": [],
        "global_warnings": [],
    }

    tecnici_data = [{"id": t.id, "ore_giornaliere": t.ore_giornaliere or 8} for t in tecnici]
    total_backlog = len(planned_wos) + len(deferred_wos)

    efficiency = calculate_plan_efficiency(plan_json_eval, tecnici_data, total_backlog)

    return {
        "efficiency_score": efficiency.get("efficiency_score", 0),
        "efficiency_breakdown": efficiency.get("efficiency_breakdown", {}),
        "efficiency_motivations": efficiency.get("efficiency_motivations", []),
        "ticket_pianificati": len(planned_wos),
        "ticket_aperti": len(open_tickets),
    }


@router.post("/confirm/{plan_id}")
@limiter.limit("5/minute")
def confirm_plan(
    request: Request,
    plan_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    payload: dict = Depends(get_current_user_payload),
):
    """
    Conferma un piano draft:
    - Assegna plan_number progressivo per tenant (con lock per evitare race condition)
    - Aggiorna tecnico_id, planned_start, planned_finish sui ticket pianificati
    - Imposta asset con fermo_on_schedule in stato tecnico 'stopped' (FERMO PROG. in UI)
    - Salva confirmed_by (username dal token)
    Tutta l'operazione è atomica: in caso di errore viene eseguito rollback completo.
    """
    plan = db.query(GeneratedPlan).filter(
        GeneratedPlan.id == plan_id,
        GeneratedPlan.tenant_id == tenant_id,
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail=f"Piano {plan_id} non trovato")

    if plan.status == "confirmed":
        raise HTTPException(status_code=400, detail="Il piano è già stato confermato")

    plan_data = plan.plan_json or {}
    confirmed_by = payload.get("sub") or payload.get("email") or "sconosciuto"

    try:
        # Aggiorna i ticket pianificati (zero nuovi record).
        # Se un WO e splittato su piu frammenti, plan_json contiene piu righe
        # con lo stesso wo_id: raggruppiamo per evitare che l'ultima
        # continuazione sovrascriva il primo frammento.
        planned = plan_data.get("planned_workorders", [])
        planned_by_wo: dict[int, list[dict]] = {}
        for wo in planned:
            wo_id = wo.get("wo_id")
            if wo_id:
                planned_by_wo.setdefault(int(wo_id), []).append(wo)

        for wo_id, fragments in planned_by_wo.items():
            ticket = db.query(Ticket).filter(
                Ticket.id == wo_id,
                Ticket.tenant_id == tenant_id,
            ).first()

            if not ticket:
                logger.warning("Confirm plan: ticket %s non trovato", wo_id)
                continue

            primary = next(
                (w for w in fragments if not w.get("is_continuation", False)),
                fragments[0],
            )
            tecnico_id = primary.get("technician_id")
            ticket.tecnico_id = tecnico_id
            ticket.stato = "Pianificato"

            intervals = [
                parsed for parsed in (_planned_wo_interval(w) for w in fragments)
                if parsed is not None
            ]
            if intervals:
                ticket.planned_start = min(start for start, _ in intervals)
                ticket.planned_finish = max(end for _, end in intervals)
            else:
                logger.warning("Confirm plan: impossibile parsare data/ora per ticket %s", wo_id)

        # Aggiorna asset con fermo_on_schedule
        for fa in plan_data.get("fermo_assets", []):
            asset_id = fa.get("asset_id")
            if not asset_id:
                continue
            asset = db.query(Asset).filter(
                Asset.id == asset_id,
                Asset.tenant_id == tenant_id,
            ).first()
            if asset:
                asset.stato = "stopped"
                logger.info("Asset %s impostato in stato FERMO PROG.", asset_id)

        # Assegna plan_number progressivo con lock per evitare race condition
        # 1. Lock a riga sul Tenant per serializzare le conferme dello stesso tenant
        db.query(Tenant).filter(Tenant.id == tenant_id).with_for_update().first()

        # 2. Query aggregata per il massimo numero (ora sicura grazie al lock sopra)
        max_num = db.query(func.max(GeneratedPlan.plan_number)).filter(
            GeneratedPlan.tenant_id == tenant_id,
            GeneratedPlan.plan_number.isnot(None),
        ).scalar()
        plan.plan_number = (max_num or 0) + 1

        # Scadenza: ultima data pianificata tra i workorder del piano
        plan.scadenza = _compute_scadenza(plan_data)

        # Segna piano come confermato
        plan.status = "confirmed"
        plan.confirmed_at = datetime.now(timezone.utc)
        plan.confirmed_by = confirmed_by

        db.commit()
        db.refresh(plan)

    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.error("Confirm plan: errore durante conferma piano %s: %s", plan_id, exc, exc_info=True)
        db_error("PLANNING", f"Errore durante conferma piano #{plan_id}: {exc}", tenant_id=tenant_id)
        raise HTTPException(status_code=500, detail=f"Errore durante la conferma del piano: {exc}")

    completion_pct = _compute_completion_pct(plan, db)
    logger.info(
        "AI Planning: piano %s confermato da %s (PIANO-%03d) scadenza=%s",
        plan_id, plan.confirmed_by, plan.plan_number,
        plan.scadenza.strftime("%Y-%m-%d") if plan.scadenza else "n/a",
    )
    return _plan_to_dict(plan, completion_pct=completion_pct)


@router.post("/deauthorize/{plan_id}")
@limiter.limit("5/minute")
def deauthorize_plan(
    request: Request,
    plan_id: int,
    data: DeauthorizeRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    payload: dict = Depends(get_current_user_payload),
):
    """
    Deautorizza un piano confermato.
    Flag amministrativo: NON modifica i ticket già pianificati.
    """
    plan = db.query(GeneratedPlan).filter(
        GeneratedPlan.id == plan_id,
        GeneratedPlan.tenant_id == tenant_id,
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail=f"Piano {plan_id} non trovato")

    if plan.status == "deauthorized":
        raise HTTPException(status_code=400, detail="Il piano è già stato deautorizzato")

    if plan.status != "confirmed":
        raise HTTPException(status_code=400, detail="Solo i piani confermati possono essere deautorizzati")

    plan.status = "deauthorized"
    plan.deauthorized_at = datetime.now(timezone.utc)
    plan.deauthorized_by = payload.get("sub", "sconosciuto")
    plan.deauthorization_reason = data.reason.strip()

    db.commit()
    db.refresh(plan)

    logger.info(
        "AI Planning: piano %s (PIANO-%03d) deautorizzato da %s — motivo: %s",
        plan_id, plan.plan_number or 0, plan.deauthorized_by, plan.deauthorization_reason[:50],
    )
    return _plan_to_dict(plan)



@router.get("/current")
def get_current_plan(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Ritorna l'ultimo piano in stato draft per il tenant corrente."""
    plan = (
        db.query(GeneratedPlan)
        .filter(GeneratedPlan.status == "draft", GeneratedPlan.tenant_id == tenant_id)
        .order_by(GeneratedPlan.created_at.desc())
        .first()
    )
    if not plan:
        return None
    completion_pct = _compute_completion_pct(plan, db)
    return _plan_to_dict(plan, completion_pct=completion_pct)


@router.get("/status")
def get_planning_status(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Endpoint diagnostico: ritorna lo stato del sistema per il planning.
    Mostra conteggio ticket per stato, tecnici, tenant_id — senza chiamate AI.
    """
    import os

    # Ticket per stato
    ticket_filter = db.query(Ticket.stato, func.count(Ticket.id))
    if tenant_id:
        ticket_filter = ticket_filter.filter(Ticket.tenant_id == tenant_id)
    stati_ticket = dict(ticket_filter.group_by(Ticket.stato).all())

    pianificabili = sum(
        v for k, v in stati_ticket.items() if k in ("Aperto", "Pianificato")
    )

    # Tecnici attivi
    tec_q = db.query(func.count(Tecnico.id)).filter(Tecnico.stato == "in servizio")
    if tenant_id:
        tec_q = tec_q.filter(Tecnico.tenant_id == tenant_id)
    tecnici_attivi = tec_q.scalar() or 0

    # Ultimo piano
    lp_q = db.query(GeneratedPlan)
    if tenant_id:
        lp_q = lp_q.filter(GeneratedPlan.tenant_id == tenant_id)
    last_plan = lp_q.order_by(GeneratedPlan.created_at.desc()).first()

    return {
        "tenant_id": tenant_id,
        "ticket_per_stato": stati_ticket,
        "ticket_pianificabili": pianificabili,
        "tecnici_in_servizio": tecnici_attivi,
        "has_openai_key": bool(os.getenv("OPENAI_API_KEY", "").strip()),
        "ultimo_piano_id": last_plan.id if last_plan else None,
        "ultimo_piano_status": last_plan.status if last_plan else None,
    }


@router.get("/history")
def get_plan_history(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Ritorna i piani confermati e deautorizzati (max 50),
    ordinati per plan_number decrescente (più recente prima).
    """
    plans = (
        db.query(GeneratedPlan)
        .filter(
            GeneratedPlan.status.in_(["confirmed", "deauthorized"]),
            GeneratedPlan.tenant_id == tenant_id,
        )
        .order_by(
            GeneratedPlan.plan_number.desc().nullslast(),
            GeneratedPlan.confirmed_at.desc(),
        )
        .limit(50)
        .all()
    )

    # Calcola completion_pct in batch: una sola query per tutti i piani
    pct_map = _batch_completion_pct(plans, db)
    return [_plan_to_dict(p, completion_pct=pct_map.get(p.id)) for p in plans]


@router.get("/rolling-analysis")
def get_rolling_analysis(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Analisi Rolling 7-Day: readiness gate, freeze zones, insertion/disruption score, PM protection.

    Valuta tutti i ticket aperti e pianificati del tenant rispetto all'orizzonte mobile di 7 giorni:
    - Planning status (READY / NOT_READY) con bottleneck tracciabili
    - Freeze zone corrente (FROZEN_24 / PROTECTED_48 / FLEXIBLE_72 / DYNAMIC_168 / non schedulato)
    - Insertion score e disruption cost per ogni ticket
    - Protezione PM in scadenza
    - KPI aggregati: saturazione, compliance prevista, breakdown backlog per zona

    Implementa docs/rolling.md — proxy documentati per campi non presenti nel DB v2.2.0.
    """
    from backend.db.modelli import AttivitaManutenzione
    import re

    # ── Carica ticket (aperti + pianificati) ──────────────────────────────────
    tickets_orm = (
        db.query(Ticket)
        .filter(
            Ticket.tenant_id == tenant_id,
            Ticket.stato.in_(["Aperto", "Pianificato"]),
        )
        .limit(500)
        .all()
    )

    # ── Carica scadenze PM (AttivitaManutenzione.prossima_scadenza per asset) ──
    asset_ids = list({t.asset_id for t in tickets_orm if t.asset_id})
    scadenze_map: dict = {}
    if asset_ids:
        scadenze_rows = (
            db.query(
                AttivitaManutenzione.asset_id,
                AttivitaManutenzione.prossima_scadenza,
            )
            .filter(
                AttivitaManutenzione.asset_id.in_(asset_ids),
                AttivitaManutenzione.prossima_scadenza.isnot(None),
            )
            .order_by(AttivitaManutenzione.prossima_scadenza.asc())
            .all()
        )
        # Prendi la scadenza più imminente per asset
        for row in scadenze_rows:
            if row.asset_id not in scadenze_map:
                scadenze_map[row.asset_id] = row.prossima_scadenza

    # ── Carica tecnici attivi ─────────────────────────────────────────────────
    tecnici_orm = (
        db.query(Tecnico)
        .filter(
            Tecnico.tenant_id == tenant_id,
            Tecnico.stato.in_(["in servizio", "in_servizio"]),
        )
        .all()
    )

    def _split(raw):
        if not raw:
            return []
        parts = re.split(r"[,;\s]+", raw.strip())
        return [p.strip().upper() for p in parts if p.strip()]

    tecnici_input = [
        TecnicoInput(
            id=t.id,
            competenze=_split(t.competenze) + ["PM", "CM", "BD"],  # workaround bridge
            stato=t.stato,
        )
        for t in tecnici_orm
    ]

    # ── Costruisci RollingTicketInput ─────────────────────────────────────────
    ticket_inputs = [
        RollingTicketInput(
            ticket_id=t.id,
            titolo=t.titolo or f"Ticket #{t.id}",
            tipo=t.tipo or "CM",
            priorita=t.priorita or "Media",
            stato=t.stato or "Aperto",
            durata_stimata_ore=float(t.durata_stimata_ore) if t.durata_stimata_ore else None,
            planned_start=t.planned_start,
            planned_finish=t.planned_finish,
            tecnico_id=t.tecnico_id,
            area=None,       # non direttamente sul ticket — futuro: join Asset
            impianto_id=None,
            asset_criticality=None,   # campo non presente nel DB
            prossima_scadenza=scadenze_map.get(t.asset_id) if t.asset_id else None,
            is_manual_plan=getattr(t, "is_manual_plan", False),
        )
        for t in tickets_orm
    ]

    if not ticket_inputs:
        return {
            "analyses": [],
            "ready_count": 0,
            "not_ready_count": 0,
            "frozen_count": 0,
            "protected_count": 0,
            "flexible_count": 0,
            "dynamic_count": 0,
            "unscheduled_count": 0,
            "pm_protected_count": 0,
            "kpi": {},
            "warnings": ["Nessun ticket aperto o pianificato trovato."],
        }

    # ── Esegui analisi ────────────────────────────────────────────────────────
    result = run_rolling_analysis(ticket_inputs, tecnici_input)

    # ── Serializza ────────────────────────────────────────────────────────────
    return {
        "analyses": [
            {
                "ticket_id":          a.ticket_id,
                "titolo":             a.titolo,
                "tipo":               a.tipo,
                "rolling_type":       a.rolling_type,
                "priorita":           a.priorita,
                "priority_class":     a.priority_class,
                "planning_status":    a.planning_status,
                "bottlenecks":        a.bottlenecks,
                "freeze_zone":        a.freeze_zone,
                "pm_protected":       a.pm_protected,
                "pm_protection_reason": a.pm_protection_reason,
                "insertion_score":    a.insertion_score,
                "disruption_cost":    a.disruption_cost,
                "net_value":          a.net_value,
                "can_enter":          a.can_enter,
                "notes":              a.notes,
            }
            for a in result.analyses
        ],
        "ready_count":       result.ready_count,
        "not_ready_count":   result.not_ready_count,
        "frozen_count":      result.frozen_count,
        "protected_count":   result.protected_count,
        "flexible_count":    result.flexible_count,
        "dynamic_count":     result.dynamic_count,
        "unscheduled_count": result.unscheduled_count,
        "pm_protected_count": result.pm_protected_count,
        "kpi":     result.kpi,
        "warnings": result.warnings,
    }


# ── Endpoint GET /planning/opportunistic ─────────────────────────────────────

@router.get("/opportunistic")
async def get_opportunistic_suggestions(
    technician_id: int,
    date: str,
    free_slot_hours: float = 2.0,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Suggerisce ticket PM da accorpare quando il tecnico ha slot liberi
    nell'area/impianto in cui è già operativo.
    Ritorna top 5 candidati per insertion_score.
    """
    free_slot_hours = max(0.5, min(24.0, free_slot_hours))  # clamp sicurezza
    suggestions = await find_opportunistic_suggestions(
        db=db,
        technician_id=technician_id,
        date_str=date,
        free_slot_hours=free_slot_hours,
        tenant_id=tenant_id,
    )
    return suggestions


# ── Pydantic schema per feedback ──────────────────────────────────────────────

class FeedbackRequest(BaseModel):
    ticket_id: int
    generated_plan_id: Optional[int] = None
    actual_start: Optional[str] = None       # ISO "YYYY-MM-DDTHH:MM:SS"
    actual_finish: Optional[str] = None
    actual_technician_id: Optional[int] = None
    execution_outcome: str = "completed"     # completed|partial|cancelled|rescheduled
    user_rating: Optional[int] = None        # 1-5
    user_notes: Optional[str] = None


class ReplanningRequest(BaseModel):
    trigger: Literal["new_breakdown", "technician_absent", "ticket_urgent"]
    affected_ticket_ids: List[int] = []
    locked_ticket_ids: List[int] = []
    horizon_days: int = 7

    @field_validator("horizon_days")
    @classmethod
    def clamp_horizon(cls, v: int) -> int:
        return max(1, min(30, v))


# ── Endpoint POST /planning/replanning ───────────────────────────────────────

@router.post("/replanning")
async def adaptive_replanning(
    data: ReplanningRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Ricalcola il piano in modo adattivo a partire da un evento specifico.

    - I locked_ticket_ids (e i ticket 'In corso' o manuali) non vengono toccati.
    - Ritorna il diff rispetto al piano precedente (disruption_cost = numero di WO
      che hanno cambiato tecnico o data rispetto all'ultimo piano draft/confirmed).
    - Il nuovo piano viene salvato come 'draft', pronto per la conferma manuale.

    Multi-tenant: opera solo sui dati del tenant corrente.
    """
    # ── FEATURE FLAG: Generazione AI disattivata ─────────────────────────────
    import os as _os_replan
    if _os_replan.getenv("AI_PLANNING_ENABLED", "false").lower() != "true":
        raise HTTPException(
            status_code=503,
            detail="La generazione AI del piano è temporaneamente disattivata.",
        )
    # ── FINE FEATURE FLAG ────────────────────────────────────────────────────
    # Piano precedente (per calcolare il disruption_cost)
    prev_plan = (
        db.query(GeneratedPlan)
        .filter(
            GeneratedPlan.tenant_id == tenant_id,
            GeneratedPlan.status.in_(["draft", "confirmed"]),
        )
        .order_by(GeneratedPlan.created_at.desc())
        .first()
    )

    # Costruisci il set di ticket da non toccare
    # 1. Espliciti dal chiamante
    locked_set = set(data.locked_ticket_ids)
    # 2. Ticket manuali o 'In corso': non vengono mai toccati dal replanning
    manual_and_inprogress = (
        db.query(Ticket.id)
        .filter(
            Ticket.tenant_id == tenant_id,
            Ticket.deleted_at.is_(None),
        )
        .filter(
            (Ticket.is_manual_plan == True) | (Ticket.stato == "In corso")  # noqa: E712
        )
        .all()
    )
    for (tid,) in manual_and_inprogress:
        locked_set.add(tid)

    logger.info(
        "adaptive_replanning: trigger=%s affected=%s locked=%s horizon=%sd tenant=%s",
        data.trigger, data.affected_ticket_ids, len(locked_set), data.horizon_days, tenant_id,
    )

    # Genera nuovo piano deterministico
    # Il bridge gestisce autonomamente locked (tecnico_id + planned_start valorizzati,
    # is_manual_plan=True) — il parametro locked_set qui serve solo per il calcolo
    # del disruption_cost; non viene passato al bridge perché i ticket locked
    # non entrano già nella coda pianificabile.
    new_plan_json = await generate_deterministic_plan(
        db=db,
        days=data.horizon_days,
        asset_ids=None,
        tenant_id=tenant_id,
    )

    if "error" in new_plan_json:
        msg = new_plan_json["error"]
        db_error("PLANNING", f"adaptive_replanning: errore bridge — {msg}", tenant_id=tenant_id)
        raise HTTPException(status_code=500, detail=f"Errore motore deterministico: {msg}")

    # Salva come nuovo draft
    new_plan = GeneratedPlan(
        tenant_id=tenant_id,
        status="draft",
        horizon_days=data.horizon_days,
        plan_json=new_plan_json,
    )
    db.add(new_plan)
    db.commit()
    db.refresh(new_plan)

    # Calcola disruption_cost: WO che hanno cambiato tecnico o data rispetto al piano precedente
    disruption_cost = 0
    moved_tickets: List[int] = []
    if prev_plan and prev_plan.plan_json:
        prev_wos = {
            w["wo_id"]: w
            for w in (prev_plan.plan_json.get("planned_workorders") or [])
        }
        for wo in (new_plan_json.get("planned_workorders") or []):
            prev = prev_wos.get(wo["wo_id"])
            if prev and (
                prev.get("technician_id") != wo.get("technician_id")
                or prev.get("planned_date") != wo.get("planned_date")
            ):
                disruption_cost += 1
                moved_tickets.append(wo["wo_id"])

    db_info(
        db, "PLANNING",
        f"adaptive_replanning [{data.trigger}]: nuovo piano #{new_plan.id} "
        f"disruption_cost={disruption_cost} moved={moved_tickets}",
        tenant_id=tenant_id,
    )

    return {
        "replanning_plan_id": new_plan.id,
        "trigger": data.trigger,
        "affected_tickets": data.affected_ticket_ids,
        "moved_tickets": moved_tickets,
        "disruption_cost": disruption_cost,
        "plan_json": new_plan_json,
    }


# ── Endpoint POST /planning/feedback ─────────────────────────────────────────

@router.post("/feedback")
def submit_feedback(
    data: FeedbackRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Registra il feedback di esecuzione per un ticket pianificato.
    Calcola automaticamente: actual_duration_hours, duration_delta_hours,
    date_delta_days, technician_changed.
    Isolamento multi-tenant: verifica che il ticket appartenga al tenant corrente.
    """
    # Validazione outcome
    valid_outcomes = {"completed", "partial", "cancelled", "rescheduled"}
    if data.execution_outcome not in valid_outcomes:
        raise HTTPException(
            status_code=422,
            detail=f"execution_outcome non valido. Valori ammessi: {sorted(valid_outcomes)}",
        )

    # Validazione rating
    if data.user_rating is not None and not (1 <= data.user_rating <= 5):
        raise HTTPException(status_code=422, detail="user_rating deve essere compreso tra 1 e 5")

    # Carica ticket — isolamento tenant
    ticket = db.query(Ticket).filter(
        Ticket.id == data.ticket_id,
        Ticket.tenant_id == tenant_id,
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail=f"Ticket {data.ticket_id} non trovato")

    # Calcola durata reale
    actual_start_dt: Optional[datetime] = None
    actual_finish_dt: Optional[datetime] = None
    actual_duration_hours: Optional[float] = None
    if data.actual_start:
        try:
            actual_start_dt = datetime.fromisoformat(data.actual_start)
        except ValueError:
            raise HTTPException(status_code=422, detail="actual_start non è un datetime ISO valido")
    if data.actual_finish:
        try:
            actual_finish_dt = datetime.fromisoformat(data.actual_finish)
        except ValueError:
            raise HTTPException(status_code=422, detail="actual_finish non è un datetime ISO valido")
    if actual_start_dt and actual_finish_dt:
        actual_duration_hours = round(
            (actual_finish_dt - actual_start_dt).total_seconds() / 3600, 2
        )

    # Calcola delta durata (reale - stimata)
    estimated = float(ticket.durata_stimata_ore or 0.0)
    duration_delta: Optional[float] = None
    if actual_duration_hours is not None:
        duration_delta = round(actual_duration_hours - estimated, 2)

    # Calcola delta data (reale - pianificata, in giorni)
    date_delta: Optional[int] = None
    if actual_start_dt and ticket.planned_start:
        planned_date = ticket.planned_start.date() if isinstance(ticket.planned_start, datetime) else ticket.planned_start
        actual_date = actual_start_dt.date()
        date_delta = (actual_date - planned_date).days

    # Verifica cambio tecnico
    technician_changed = False
    if data.actual_technician_id is not None and ticket.tecnico_id is not None:
        technician_changed = (data.actual_technician_id != ticket.tecnico_id)

    # Ricava confidence_score_at_plan se disponibile nel piano
    confidence_at_plan: Optional[float] = None
    if data.generated_plan_id:
        plan = db.query(GeneratedPlan).filter(
            GeneratedPlan.id == data.generated_plan_id,
            GeneratedPlan.tenant_id == tenant_id,
        ).first()
        if plan and plan.plan_json:
            for wo in plan.plan_json.get("planned_workorders", []):
                if wo.get("wo_id") == data.ticket_id:
                    confidence_at_plan = wo.get("confidence_score")
                    break

    # Salva feedback
    feedback = PlannerFeedback(
        tenant_id=tenant_id,
        ticket_id=data.ticket_id,
        generated_plan_id=data.generated_plan_id,
        planned_date=ticket.planned_start.date() if ticket.planned_start else None,
        planned_technician_id=ticket.tecnico_id,
        estimated_duration_hours=estimated if estimated > 0 else None,
        confidence_score_at_plan=confidence_at_plan,
        actual_start=actual_start_dt,
        actual_finish=actual_finish_dt,
        actual_duration_hours=actual_duration_hours,
        actual_technician_id=data.actual_technician_id,
        execution_outcome=data.execution_outcome,
        duration_delta_hours=duration_delta,
        date_delta_days=date_delta,
        technician_changed=technician_changed,
        user_rating=data.user_rating,
        user_notes=data.user_notes,
        ticket_tipo=ticket.tipo,
        asset_id=ticket.asset_id,
    )
    db.add(feedback)
    db.commit()
    db.refresh(feedback)

    db_info(
        db, "PLANNING_FEEDBACK",
        f"Feedback ticket #{data.ticket_id}: outcome={data.execution_outcome}, delta_h={duration_delta}, delta_gg={date_delta}",
        tenant_id=tenant_id,
    )

    return {
        "id": feedback.id,
        "ticket_id": feedback.ticket_id,
        "execution_outcome": feedback.execution_outcome,
        "actual_duration_hours": feedback.actual_duration_hours,
        "duration_delta_hours": feedback.duration_delta_hours,
        "date_delta_days": feedback.date_delta_days,
        "technician_changed": feedback.technician_changed,
        "confidence_score_at_plan": feedback.confidence_score_at_plan,
        "created_at": feedback.created_at.isoformat() if feedback.created_at else None,
    }


# ── Endpoint GET /planning/feedback/{ticket_id} ───────────────────────────────

@router.get("/feedback/{ticket_id}")
def get_feedback(
    ticket_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Ritorna la lista dei feedback di esecuzione per un ticket.
    Isolamento multi-tenant: filtra per tenant_id.
    """
    # Verifica che il ticket appartenga al tenant
    ticket = db.query(Ticket).filter(
        Ticket.id == ticket_id,
        Ticket.tenant_id == tenant_id,
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail=f"Ticket {ticket_id} non trovato")

    feedbacks = db.query(PlannerFeedback).filter(
        PlannerFeedback.ticket_id == ticket_id,
        PlannerFeedback.tenant_id == tenant_id,
    ).order_by(PlannerFeedback.created_at.desc()).all()

    return [
        {
            "id": f.id,
            "ticket_id": f.ticket_id,
            "generated_plan_id": f.generated_plan_id,
            "planned_date": f.planned_date.isoformat() if f.planned_date else None,
            "planned_technician_id": f.planned_technician_id,
            "estimated_duration_hours": f.estimated_duration_hours,
            "confidence_score_at_plan": f.confidence_score_at_plan,
            "actual_start": f.actual_start.isoformat() if f.actual_start else None,
            "actual_finish": f.actual_finish.isoformat() if f.actual_finish else None,
            "actual_duration_hours": f.actual_duration_hours,
            "actual_technician_id": f.actual_technician_id,
            "execution_outcome": f.execution_outcome,
            "duration_delta_hours": f.duration_delta_hours,
            "date_delta_days": f.date_delta_days,
            "technician_changed": f.technician_changed,
            "user_rating": f.user_rating,
            "user_notes": f.user_notes,
            "ticket_tipo": f.ticket_tipo,
            "asset_id": f.asset_id,
            "created_at": f.created_at.isoformat() if f.created_at else None,
        }
        for f in feedbacks
    ]


# ── Endpoint GET /planning/feedback/analytics ─────────────────────────────────

@router.get("/feedback/analytics")
def feedback_analytics(
    days: int = 30,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Aggregazioni sui feedback di esecuzione per il tenant.
    Periodo: ultimi N giorni (default 30).
    Ritorna metriche aggregate utili per valutare la qualità delle stime del planner.
    """
    from datetime import date as date_type

    since = datetime.now(timezone.utc) - timedelta(days=days)

    feedbacks = db.query(PlannerFeedback).filter(
        PlannerFeedback.tenant_id == tenant_id,
        PlannerFeedback.created_at >= since,
    ).all()

    total = len(feedbacks)
    if total == 0:
        return {
            "period_days": days,
            "total_records": 0,
            "avg_duration_delta_hours": None,
            "on_time_rate": None,
            "technician_change_rate": None,
            "by_tipo": {},
        }

    # Calcola metriche globali
    duration_deltas = [f.duration_delta_hours for f in feedbacks if f.duration_delta_hours is not None]
    avg_duration_delta = round(sum(duration_deltas) / len(duration_deltas), 2) if duration_deltas else None

    on_time = sum(1 for f in feedbacks if f.date_delta_days is not None and f.date_delta_days <= 0)
    on_time_rate = round(on_time / total, 3) if total > 0 else None

    tech_changed = sum(1 for f in feedbacks if f.technician_changed)
    technician_change_rate = round(tech_changed / total, 3) if total > 0 else None

    # Breakdown per tipo ticket
    by_tipo: Dict[str, dict] = {}
    for tipo in ("PM", "CM", "BD"):
        subset = [f for f in feedbacks if f.ticket_tipo == tipo]
        if not subset:
            continue
        deltas = [f.duration_delta_hours for f in subset if f.duration_delta_hours is not None]
        by_tipo[tipo] = {
            "count": len(subset),
            "avg_delta": round(sum(deltas) / len(deltas), 2) if deltas else None,
        }

    return {
        "period_days": days,
        "total_records": total,
        "avg_duration_delta_hours": avg_duration_delta,
        "on_time_rate": on_time_rate,
        "technician_change_rate": technician_change_rate,
        "by_tipo": by_tipo,
    }
@router.post("/clear")
def clear_gantt(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    from backend.db.modelli import Ticket, GeneratedPlan
    tickets = db.query(Ticket).filter(Ticket.tenant_id == tenant_id, Ticket.stato == "Pianificato", Ticket.deleted_at.is_(None)).all()
    for t in tickets:
        t.stato = "Aperto"
        t.planned_start = None
        t.planned_finish = None
        t.tecnico_id = None
        
    drafts = db.query(GeneratedPlan).filter(GeneratedPlan.tenant_id == tenant_id, GeneratedPlan.status == "draft").all()
    for d in drafts:
        db.delete(d)
        
    db.commit()
    return {"message": "Gantt svuotato", "cleared_count": len(tickets)}

