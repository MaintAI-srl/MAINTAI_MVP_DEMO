"""
PlannerEngine Bridge — Adattatore tra i modelli ORM e il PlannerEngine deterministico.

Converte:
  ORM (Ticket, Tecnico, Asset, TecnicoAssenza) → PlannerTecnico / PlannerTicket
  PlannerResult                                 → plan_json (formato identico al motore AI)

Uso:
  from backend.services.planner_engine_bridge import generate_deterministic_plan
  plan_json = await generate_deterministic_plan(db, days=7, tenant_id=1)
"""
from __future__ import annotations

import re
import logging
from datetime import date as date_type, datetime, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.db.modelli import Asset, Tecnico, Ticket, TecnicoAssenza
from backend.services.adaptive_estimator import get_duration_correction_factor
from backend.services.planner_engine import (
    PlannerAssignment,
    PlannerEngine,
    PlannerTecnico,
    PlannerTicket,
    REASON_CAPACITY_EXCEEDED,
    REASON_LIMITATION_MISMATCH,
    REASON_MULTI_TECH_NOT_FOUND,
    REASON_NO_AVAILABILITY,
    REASON_NO_SKILL,
    REASON_TIME_WINDOW_CONFLICT,
)
from backend.services.ai_planner_service import calculate_plan_efficiency
from backend.services.ai_planner_service import _check_weather_constraint
from backend.services.weather_service import get_weather_forecast
from backend.core.logger_db import db_info

logger = logging.getLogger(__name__)

# ── Traduzione reason codes → italiano ────────────────────────────────────────

REASON_IT: Dict[str, str] = {
    REASON_NO_SKILL:             "Nessun tecnico con le competenze richieste disponibile nell'orizzonte",
    REASON_NO_AVAILABILITY:      "Nessuna disponibilità nel periodo pianificato",
    REASON_TIME_WINDOW_CONFLICT: "Finestra temporale fuori dall'orizzonte di pianificazione",
    REASON_CAPACITY_EXCEEDED:    "Capacità giornaliera dei tecnici esaurita nell'orizzonte",
    REASON_LIMITATION_MISMATCH:  "Conflitto tra limitazioni operative del ticket e del tecnico",
    REASON_MULTI_TECH_NOT_FOUND: "Non trovato il numero richiesto di tecnici qualificati",
}


# ── Helpers di conversione ────────────────────────────────────────────────────

def _compute_wo_confidence(
    assignment: "PlannerAssignment",
    ticket: "PlannerTicket",
    durata_assegnata_h: float,
    ore_libere_giorno: float,
    has_finestra: bool,
    finestra_days: int,
) -> dict:
    """
    Calcola confidence_score, risk_level e complexity per un WO pianificato.

    Formula:
    - base 1.0
    - is_continuation → *0.90
    - finestra stretta (<= 2gg) → *0.88, (<= 4gg) → *0.94
    - slot quasi saturo (durata/ore_libere > 0.9) → *0.85
    - clamp [0.4, 1.0]

    Risk: LOW ≥0.85, MEDIUM ≥0.65, HIGH <0.65
    Complexity: SIMPLE (≤2h, 1 tecnico), COMPLEX (>8h o multi), STANDARD altrimenti
    """
    conf = 1.0
    if assignment.is_continuation:
        conf *= 0.9
    if has_finestra:
        if finestra_days <= 2:
            conf *= 0.88
        elif finestra_days <= 4:
            conf *= 0.94
    if ore_libere_giorno > 0 and durata_assegnata_h / ore_libere_giorno > 0.9:
        conf *= 0.85
    conf = max(0.4, min(1.0, conf))

    if conf >= 0.85:
        risk = "LOW"
    elif conf >= 0.65:
        risk = "MEDIUM"
    else:
        risk = "HIGH"

    if ticket.durata_stimata_ore <= 2.0 and ticket.tecnici_richiesti <= 1:
        complexity = "SIMPLE"
    elif ticket.durata_stimata_ore > 8.0 or ticket.tecnici_richiesti > 1:
        complexity = "COMPLEX"
    else:
        complexity = "STANDARD"

    return {
        "confidence_score": round(conf, 3),
        "risk_level": risk,
        "complexity": complexity,
    }


def _split_competenze(raw: Optional[str]) -> List[str]:
    """Split stringa competenze (virgola/spazio/punto-e-virgola) → lista uppercase."""
    if not raw:
        return []
    parts = re.split(r"[,;\s]+", raw.strip())
    return [p.strip().upper() for p in parts if p.strip()]


# Competenze di tipo "manutenzione" (non job-skill specifici)
_TIPO_IMPLICITI = ["PM", "CM", "BD"]
# Job-skill specifici che indicano un tecnico con competenze strutturate
_JOB_SKILLS = {"MECCANICO", "ELETTRICISTA", "IDRAULICO", "SALDATORE", "STRUMENTISTA", "AUTOMAZIONE", "TERMOIDRAULICO", "ELETTROMECCANICO"}


def _has_job_skills(competenze: List[str]) -> bool:
    """Ritorna True se il tecnico ha almeno una job-skill specifica (es. Meccanico)."""
    return any(c.upper() in _JOB_SKILLS for c in competenze)


def _build_planner_tecnici(
    tecnici: List[Tecnico],
    assenze_map: Dict[int, List[date_type]],
    workday_end_hour: int = 17,
) -> List[PlannerTecnico]:
    """
    Costruisce la lista PlannerTecnico con logica skill matching adattiva (#4):

    - Se il tecnico NON ha job-skill specifiche (lista vuota o solo PM/CM/BD generici):
      aggiunge PM/CM/BD come competenze implicite → comportamento legacy invariato.
    - Se il tecnico HA job-skill (Meccanico, Elettricista, ecc.):
      NON aggiunge PM/CM/BD automaticamente → il campo competenza_richiesta sul
      ticket diventa un vincolo hard (strict matching).
    """
    result = []
    for t in tecnici:
        if t.stato.lower() not in ("in servizio", "in_servizio"):
            continue
        comp = _split_competenze(t.competenze)
        if not _has_job_skills(comp):
            # Nessuna job-skill: aggiungi tipi manutenzione impliciti (legacy)
            for tipo in _TIPO_IMPLICITI:
                if tipo not in comp:
                    comp.append(tipo)
        orario_inizio = t.orario_inizio or "08:00"
        orario_fine = f"{workday_end_hour:02d}:00" if workday_end_hour > 17 else (t.orario_fine or "17:00")
        try:
            start_h = int(orario_inizio.split(":", 1)[0])
        except (ValueError, IndexError):
            start_h = 8
        ore_giornaliere = max(t.ore_giornaliere or 8, workday_end_hour - start_h) if workday_end_hour > 17 else (t.ore_giornaliere or 8)
        result.append(PlannerTecnico(
            id=t.id,
            nome=f"{t.nome} {t.cognome or ''}".strip(),
            stato="in_servizio",
            competenze=comp,
            ore_giornaliere=ore_giornaliere,
            orario_inizio=orario_inizio,
            orario_fine=orario_fine,
            limitazioni=_split_competenze(t.limitazioni_orarie or ""),
            giorni_assenza=assenze_map.get(t.id, []),
        ))
    return result


def _build_planner_tickets(
    tickets: List[Ticket],
    asset_map: Dict[int, Asset],
    db: Optional[Session] = None,
    tenant_id: Optional[int] = None,
    planning_start: Optional[date_type] = None,
    weather_blocked_days: Optional[Dict[int, List[date_type]]] = None,
) -> List[PlannerTicket]:
    today_ref = planning_start or date_type.today()
    result = []
    for t in tickets:
        asset = asset_map.get(t.asset_id) if t.asset_id else None
        impianto_id: Optional[int] = None
        area: Optional[str] = None
        if asset:
            impianto_id = asset.impianto_id
            area = asset.area

        durata_base = float(t.durata_stimata_ore or 2.0)

        # Adaptive duration estimation: correggi la durata stimata in base allo storico feedback
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
                    db_info(
                        db,
                        "PLANNING",
                        f"AdaptiveEstimator: ticket #{t.id} durata {durata_base}h → {durata_corretta}h (fattore={fattore})",
                        tenant_id=tenant_id,
                    )
            except Exception as exc:
                logger.warning("AdaptiveEstimator: errore per ticket #%d: %s", t.id, exc)

        # Calcola eta_giorni (aging) per lo score priorità composito (#2)
        eta_giorni = 0
        if t.created_at:
            created = t.created_at.date() if isinstance(t.created_at, datetime) else t.created_at
            eta_giorni = max(0, (today_ref - created).days)

        # Giorni non operativi: l'asset in FERMO PROG. blocca la continuazione (#8)
        giorni_non_operativi: List[date_type] = []
        if asset and (getattr(asset, "stato", None) or "").lower() in {"stopped", "fermo", "fermo prog.", "fermo programmato"}:
            # Asset in FERMO PROG.: tutti i giorni dell'orizzonte sono non operativi
            horizon_end = today_ref + timedelta(days=30)
            d = today_ref
            while d <= horizon_end:
                giorni_non_operativi.append(d)
                d += timedelta(days=1)
        if t.asset_id and weather_blocked_days:
            giorni_non_operativi.extend(weather_blocked_days.get(t.asset_id, []))

        result.append(PlannerTicket(
            id=t.id,
            impianto_id=impianto_id,
            priorita=t.priorita or "Media",
            tipo=t.tipo or "CM",
            durata_stimata_ore=durata_corretta,
            competenza_richiesta=t.competenza_richiesta or None,
            splittabile=True,
            area=area,
            eta_giorni=eta_giorni,
            giorni_non_operativi=giorni_non_operativi,
        ))
    return result


def _build_existing_assignments(locked_tickets: List[Ticket]) -> List[PlannerAssignment]:
    """
    Converte i ticket già pianificati in PlannerAssignment locked.

    Un ticket è considerato locked (planning_directive: REGOLA DI BASE SUI TICKET GIÀ ASSEGNATI)
    quando ha ENTRAMBI: tecnico_id valorizzato E planned_start valorizzato.
    Questi ticket concorrono al consumo capacità e non devono essere toccati dal planner.
    """
    result = []
    for t in locked_tickets:
        if not t.tecnico_id or not t.planned_start:
            continue
        # planned_finish può mancare: usa planned_start + durata_stimata come fallback
        if t.planned_finish:
            end_dt = t.planned_finish
        else:
            ore = float(t.durata_stimata_ore or 2.0)
            end_dt = t.planned_start + timedelta(hours=ore)

        result.append(PlannerAssignment(
            ticket_id=t.id,
            tecnico_id=t.tecnico_id,
            start=t.planned_start if isinstance(t.planned_start, datetime) else datetime.combine(t.planned_start, datetime.min.time()),
            end=end_dt if isinstance(end_dt, datetime) else datetime.combine(end_dt, datetime.min.time()),
            locked=True,
        ))
    return result


def _build_assenze_map(
    assenze: List[TecnicoAssenza],
    horizon_start: date_type,
    horizon_end: date_type,
) -> Dict[int, List[date_type]]:
    """
    Costruisce un dizionario {tecnico_id: [giorni_assenza]} per i giorni
    nell'orizzonte di pianificazione coperti da almeno un'assenza.
    """
    result: Dict[int, List[date_type]] = {}
    for a in assenze:
        # Converti datetime → date se necessario
        inizio = a.data_inizio.date() if isinstance(a.data_inizio, datetime) else a.data_inizio
        fine = a.data_fine.date() if isinstance(a.data_fine, datetime) else a.data_fine

        # Intersezione con l'orizzonte
        inizio_eff = max(inizio, horizon_start)
        fine_eff = min(fine, horizon_end)

        giorno = inizio_eff
        while giorno <= fine_eff:
            result.setdefault(a.tecnico_id, []).append(giorno)
            giorno += timedelta(days=1)
    return result


# ── Bridge principale ─────────────────────────────────────────────────────────

async def generate_deterministic_plan(
    db: Session,
    days: int = 7,
    asset_ids: Optional[List[int]] = None,
    tenant_id: Optional[int] = None,
    start_date: Optional[date_type] = None,
    include_weekends: bool = False,
    workday_end_hour: int = 17,
) -> Dict[str, Any]:
    """
    Genera un piano manutenzione usando il PlannerEngine deterministico.
    Ritorna lo stesso formato plan_json prodotto dal motore AI (compatibilità totale).
    """
    today = start_date or date_type.today()
    horizon_end = today + timedelta(days=days - 1)

    # ── Carica ticket locked (già pianificati: non devono essere ripianificati) ─
    # Workaround: locked implicito = tecnico_id AND planned_start valorizzati, OPPURE ticket manuale
    from sqlalchemy import or_
    locked_query = db.query(Ticket).filter(
        or_(
            Ticket.tecnico_id.isnot(None) & Ticket.planned_start.isnot(None),
            Ticket.is_manual_plan.is_(True)
        )
    )
    if tenant_id:
        locked_query = locked_query.filter(Ticket.tenant_id == tenant_id)
    locked_tickets = locked_query.all()
    locked_ids = {t.id for t in locked_tickets}

    # ── Carica ticket pianificabili (Aperto, oppure Pianificato senza assegnazione) ──
    ticket_query = db.query(Ticket).filter(
        Ticket.stato.in_(["Aperto", "Pianificato"]),
    )
    if locked_ids:
        # Escludi i ticket già assegnati (locked implicito) dalla coda pianificabile
        ticket_query = ticket_query.filter(~Ticket.id.in_(locked_ids))
    if tenant_id:
        ticket_query = ticket_query.filter(Ticket.tenant_id == tenant_id)
    if asset_ids:
        ticket_query = ticket_query.filter(Ticket.asset_id.in_(asset_ids))
    tickets = ticket_query.all()

    # ── Carica tecnici attivi ─────────────────────────────────────────────────
    tecnico_query = db.query(Tecnico).filter(
        Tecnico.stato.in_(["in servizio", "in_servizio"])
    )
    if tenant_id:
        tecnico_query = tecnico_query.filter(Tecnico.tenant_id == tenant_id)
    tecnici = tecnico_query.all()

    # ── Guardrail: backlog vuoto ──────────────────────────────────────────────
    if not tickets:
        return {
            "planned_workorders": [],
            "deferred_workorders": [],
            "fermo_assets": [],
            "global_warnings": ["Nessun ticket aperto o pianificabile trovato nel sistema."],
            "efficiency_score": 0,
            "efficiency_breakdown": {},
            "efficiency_motivations": [],
        }

    # ── Guardrail: nessun tecnico ─────────────────────────────────────────────
    if not tecnici:
        return {
            "planned_workorders": [],
            "deferred_workorders": [
                {"wo_id": t.id, "reason": "Nessun tecnico disponibile in servizio"}
                for t in tickets
            ],
            "fermo_assets": [],
            "global_warnings": ["Nessun tecnico in servizio trovato nel sistema."],
            "efficiency_score": 0,
            "efficiency_breakdown": {},
            "efficiency_motivations": [],
        }

    # ── Carica assenze tecnici nell'orizzonte ─────────────────────────────────
    tecnico_ids = [t.id for t in tecnici]
    assenze = db.query(TecnicoAssenza).filter(
        TecnicoAssenza.tecnico_id.in_(tecnico_ids),
        TecnicoAssenza.data_fine >= today,
        TecnicoAssenza.data_inizio <= horizon_end,
    )
    if tenant_id:
        assenze = assenze.filter(TecnicoAssenza.tenant_id == tenant_id)
    assenze_list = assenze.all()
    assenze_map = _build_assenze_map(assenze_list, today, horizon_end)

    if assenze_list:
        logger.info(
            "PlannerEngine bridge: %d assenze caricate per %d tecnici nell'orizzonte",
            len(assenze_list), len({a.tecnico_id for a in assenze_list}),
        )

    # ── Asset map per lookup O(1) ─────────────────────────────────────────────
    asset_ids_set = list({t.asset_id for t in tickets if t.asset_id})
    assets = db.query(Asset).filter(Asset.id.in_(asset_ids_set)).all() if asset_ids_set else []
    asset_map: Dict[int, Asset] = {a.id: a for a in assets}
    weather_blocked_days: Dict[int, List[date_type]] = {}
    weather_global_warnings: List[str] = []
    for asset in assets:
        constraint = getattr(asset, "weather_constraint", None)
        if not constraint or constraint == "NONE":
            continue
        lat = getattr(asset, "latitude", None)
        lon = getattr(asset, "longitude", None)
        if lat is None or lon is None:
            weather_global_warnings.append(
                f"Meteo non valutabile per asset {asset.nome or asset.id}: coordinate mancanti."
            )
            continue
        d = today
        while d <= horizon_end:
            if include_weekends or d.weekday() < 5:
                weather = await get_weather_forecast(lat, lon, d)
                warning = _check_weather_constraint(constraint, weather)
                if warning and weather is not None:
                    weather_blocked_days.setdefault(asset.id, []).append(d)
            d += timedelta(days=1)

    # ── Conversione ORM → strutture PlannerEngine ─────────────────────────────
    planner_tecnici = _build_planner_tecnici(tecnici, assenze_map, workday_end_hour=workday_end_hour)
    planner_tickets = _build_planner_tickets(
        tickets,
        asset_map,
        db=db,
        tenant_id=tenant_id,
        planning_start=today,
        weather_blocked_days=weather_blocked_days,
    )
    existing_assignments = _build_existing_assignments(locked_tickets)

    if not planner_tecnici:
        # Tutti i tecnici filtrati per stato non valido
        return {
            "planned_workorders": [],
            "deferred_workorders": [
                {"wo_id": t.id, "reason": "Nessun tecnico attivo trovato"}
                for t in tickets
            ],
            "fermo_assets": [],
            "global_warnings": ["Nessun tecnico con stato 'in servizio' trovato."],
            "efficiency_score": 0,
            "efficiency_breakdown": {},
            "efficiency_motivations": [],
        }

    # ── Esecuzione PlannerEngine ──────────────────────────────────────────────
    logger.info(
        "PlannerEngine: avvio — %d ticket pianificabili, %d locked, %d tecnici, orizzonte %d giorni",
        len(planner_tickets), len(existing_assignments), len(planner_tecnici), days,
    )

    try:
        engine = PlannerEngine(
            tecnici=planner_tecnici,
            tickets=planner_tickets,
            existing_assignments=existing_assignments,
            today=today,
            horizon_days=days,
            include_weekends=include_weekends,
            slot_minutes=30,  # tracking a granularità 30min — evita sovrapposizioni sub-orarie
        )
        engine_result = engine.run()
    except Exception as exc:
        logger.error("PlannerEngine: eccezione durante run(): %s", exc, exc_info=True)
        return {"error": f"Errore motore deterministico: {exc}"}

    logger.info(
        "PlannerEngine: completato — %d assegnati, %d non assegnati",
        len(engine_result.assignments), len(engine_result.unassigned),
    )

    # ── Mappa ticket e tecnici per lookup O(1) nel confidence scoring ─────────
    ticket_map: Dict[int, PlannerTicket] = {pt.id: pt for pt in planner_tickets}
    tecnico_ore_map: Dict[int, float] = {pt.id: float(pt.ore_giornaliere) for pt in planner_tecnici}

    # Pre-calcola ore consumate per tecnico/giorno dagli assignment esistenti
    # (serve per stimare ore_libere al momento dell'assegnazione)
    from collections import defaultdict
    ore_consumate_per_giorno: Dict[int, Dict[Any, float]] = defaultdict(lambda: defaultdict(float))
    for a in engine_result.assignments:
        dur = round((a.end - a.start).total_seconds() / 3600, 2)
        ore_consumate_per_giorno[a.tecnico_id][a.start.date()] += dur

    # ── Converti PlannerResult → planned_workorders ───────────────────────────
    planned_workorders = []
    for a in engine_result.assignments:
        start_time = a.start.strftime("%H:%M")
        end_time   = a.end.strftime("%H:%M")
        duration_h = round((a.end - a.start).total_seconds() / 3600, 2)

        # Motivazione dal log deterministico
        log_entry = next(
            (l for l in engine_result.explanation_log if f"#{a.ticket_id}" in l),
            None,
        )
        motivation = (
            log_entry.replace("[OK] ", "").replace("[OK-SPLIT] ", "SPLIT: ").replace("[OK-NOSP] ", "")
            if log_entry else "Pianificato dal motore deterministico Felix-Engine"
        )

        # Calcola confidence score per questo WO
        ticket_obj = ticket_map.get(a.ticket_id)
        ore_giornaliere = tecnico_ore_map.get(a.tecnico_id, 8.0)
        ore_totali_giorno = ore_consumate_per_giorno[a.tecnico_id][a.start.date()]
        ore_libere = max(0.0, ore_giornaliere - (ore_totali_giorno - duration_h))

        has_finestra = False
        finestra_days = 999
        if ticket_obj and ticket_obj.finestra_inizio and ticket_obj.finestra_fine:
            has_finestra = True
            finestra_days = (ticket_obj.finestra_fine - ticket_obj.finestra_inizio).days + 1

        if ticket_obj:
            conf_data = _compute_wo_confidence(
                assignment=a,
                ticket=ticket_obj,
                durata_assegnata_h=duration_h,
                ore_libere_giorno=ore_libere,
                has_finestra=has_finestra,
                finestra_days=finestra_days,
            )
        else:
            conf_data = {"confidence_score": 0.8, "risk_level": "MEDIUM", "complexity": "STANDARD"}

        planned_workorders.append({
            "wo_id":              a.ticket_id,
            "technician_id":      a.tecnico_id,
            "planned_date":       a.start.date().isoformat(),
            "time_slot":          f"{start_time}-{end_time}",
            "planned_start_time": start_time,
            "planned_end_time":   end_time,
            "duration_hours":     duration_h,
            "motivation":         motivation,
            "warnings":           [],
            "is_continuation":    a.is_continuation,
            "parent_wo_id":       a.parent_ticket_id,
            "confidence_score":   conf_data["confidence_score"],
            "risk_level":         conf_data["risk_level"],
            "complexity":         conf_data["complexity"],
        })

    # ── Converti Unassigned → deferred_workorders ─────────────────────────────
    deferred_workorders = []
    for u in engine_result.unassigned:
        reason_it = REASON_IT.get(u.reason_code, u.detail or u.reason_code)
        deferred_workorders.append({
            "wo_id":         u.ticket_id,
            "reason":        reason_it,
            "reason_code":   u.reason_code,
            "reason_detail": u.detail or "",
            "earliest_possible_date": u.earliest_possible_date,
        })

    plan_json: Dict[str, Any] = {
        "planned_workorders":  planned_workorders,
        "deferred_workorders": deferred_workorders,
        "fermo_assets":        [],
        "global_warnings":     weather_global_warnings,
    }

    # ── Calcola feedback scores per tecnico (confidence retroalimentato #11) ──
    tech_feedback_scores: Dict[int, float] = {}
    try:
        cutoff = datetime.now() - timedelta(days=60)
        feedback_rows = db.query(
            Ticket.tecnico_id,
            func.count(Ticket.id).label("total"),
        ).filter(
            Ticket.tenant_id == tenant_id,
            Ticket.stato == "Chiuso",
            Ticket.tecnico_id.isnot(None),
            Ticket.execution_finish >= cutoff,
        ).group_by(Ticket.tecnico_id).all()

        if feedback_rows:
            for row in feedback_rows:
                tid = row.tecnico_id
                total = row.total or 1
                # Score semplificato: proporzione ticket chiusi (max 1.0)
                # In futuro: usare execution_outcome per distinguere "completed" vs altri
                tech_feedback_scores[tid] = min(1.0, total / max(total, 1))
    except Exception as exc:
        logger.warning("PlannerEngine bridge: errore query feedback scores: %s", exc)

    # Applica feedback score al confidence_score dei WO pianificati (#11)
    if tech_feedback_scores:
        for wo in plan_json.get("planned_workorders", []):
            tech_id = wo.get("technician_id")
            fb_score = tech_feedback_scores.get(tech_id)
            if fb_score is not None and wo.get("confidence_score") is not None:
                adjusted = wo["confidence_score"] * (0.5 + 0.5 * fb_score)
                wo["confidence_score"] = round(max(0.4, min(1.0, adjusted)), 3)
                # Aggiorna risk_level di conseguenza
                if wo["confidence_score"] >= 0.85:
                    wo["risk_level"] = "LOW"
                elif wo["confidence_score"] >= 0.65:
                    wo["risk_level"] = "MEDIUM"
                else:
                    wo["risk_level"] = "HIGH"

    # ── Calcola punteggio efficienza ──────────────────────────────────────────
    tecnici_data = [
        {"id": t.id, "ore_giornaliere": max(t.ore_giornaliere or 8, workday_end_hour - 8) if workday_end_hour > 17 else (t.ore_giornaliere or 8)}
        for t in tecnici
    ]
    try:
        efficiency_data = calculate_plan_efficiency(
            plan_json,
            tecnici_data,
            total_backlog=len(tickets),
            plan_start_date=today,
            plan_end_date=horizon_end,
            absences=assenze_map,
            include_weekends=include_weekends,
        )
        plan_json["efficiency_score"]       = efficiency_data["efficiency_score"]
        plan_json["efficiency_breakdown"]   = efficiency_data["efficiency_breakdown"]
        plan_json["efficiency_motivations"] = efficiency_data.get("efficiency_motivations", [])
        plan_json["plan_metadata"] = plan_json.get("plan_metadata", {})
        plan_json["plan_metadata"].update({
            "ore_disponibili_teoriche": efficiency_data.get("ore_disponibili_teoriche"),
            "ore_disponibili_effettive": efficiency_data.get("ore_disponibili_effettive"),
            "ore_assegnate": efficiency_data.get("ore_assegnate"),
        })
    except Exception as exc:
        logger.warning("PlannerEngine bridge: errore calcolo efficienza: %s", exc)
        plan_json["efficiency_score"]       = 0
        plan_json["efficiency_breakdown"]   = {}
        plan_json["efficiency_motivations"] = []

    return plan_json
