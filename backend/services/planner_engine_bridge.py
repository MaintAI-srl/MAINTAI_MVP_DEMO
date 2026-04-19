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


# Workaround documentato (planning_directive.md):
# Le competenze dei tecnici in MaintAI sono job-skill (Meccanico, Elettricista…),
# non categorie di manutenzione (PM/CM/BD). Finché il modello non espone
# `competenza_richiesta` sul ticket, aggiungiamo i tipi manutenzione standard
# come competenze implicite — SOLO per i tecnici che non ne hanno già di esplicite.
# Se il tecnico ha competenze reali nel DB, quelle prevalgono e vengono usate
# per il matching; i tipi impliciti vengono aggiunti comunque per permettere
# la pianificazione in assenza di un campo `competenza_richiesta` strutturato.
_TIPO_IMPLICITI = ["PM", "CM", "BD"]


def _build_planner_tecnici(
    tecnici: List[Tecnico],
    assenze_map: Dict[int, List[date_type]],
) -> List[PlannerTecnico]:
    result = []
    for t in tecnici:
        if t.stato.lower() not in ("in servizio", "in_servizio"):
            continue
        comp = _split_competenze(t.competenze)
        # Aggiunge tipi manutenzione impliciti (workaround — vedi commento sopra)
        for tipo in _TIPO_IMPLICITI:
            if tipo not in comp:
                comp.append(tipo)
        result.append(PlannerTecnico(
            id=t.id,
            nome=f"{t.nome} {t.cognome or ''}".strip(),
            stato="in_servizio",
            competenze=comp,
            ore_giornaliere=t.ore_giornaliere or 8,
            orario_inizio=t.orario_inizio or "08:00",
            orario_fine=t.orario_fine or "17:00",
            limitazioni=_split_competenze(t.limitazioni_orarie or ""),
            giorni_assenza=assenze_map.get(t.id, []),
        ))
    return result


def _build_planner_tickets(
    tickets: List[Ticket],
    asset_map: Dict[int, Asset],
    db: Optional[Session] = None,
    tenant_id: Optional[int] = None,
) -> List[PlannerTicket]:
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

        result.append(PlannerTicket(
            id=t.id,
            impianto_id=impianto_id,
            priorita=t.priorita or "Media",
            tipo=t.tipo or "CM",
            durata_stimata_ore=durata_corretta,
            competenza_richiesta=t.competenza_richiesta or None,
            splittabile=True,
            area=area,
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
) -> Dict[str, Any]:
    """
    Genera un piano manutenzione usando il PlannerEngine deterministico.
    Ritorna lo stesso formato plan_json prodotto dal motore AI (compatibilità totale).
    """
    today = date_type.today()
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

    # ── Conversione ORM → strutture PlannerEngine ─────────────────────────────
    planner_tecnici = _build_planner_tecnici(tecnici, assenze_map)
    planner_tickets = _build_planner_tickets(tickets, asset_map, db=db, tenant_id=tenant_id)
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
            if log_entry else "Pianificato dal motore deterministico MARCO-Engine"
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
            "earliest_possible_date": None,
        })

    plan_json: Dict[str, Any] = {
        "planned_workorders":  planned_workorders,
        "deferred_workorders": deferred_workorders,
        "fermo_assets":        [],
        "global_warnings":     [],
    }

    # ── Calcola punteggio efficienza ──────────────────────────────────────────
    tecnici_data = [
        {"id": t.id, "ore_giornaliere": t.ore_giornaliere or 8}
        for t in tecnici
    ]
    try:
        efficiency_data = calculate_plan_efficiency(
            plan_json,
            tecnici_data,
            total_backlog=len(tickets),
        )
        plan_json["efficiency_score"]       = efficiency_data["efficiency_score"]
        plan_json["efficiency_breakdown"]   = efficiency_data["efficiency_breakdown"]
        plan_json["efficiency_motivations"] = efficiency_data.get("efficiency_motivations", [])
    except Exception as exc:
        logger.warning("PlannerEngine bridge: errore calcolo efficienza: %s", exc)
        plan_json["efficiency_score"]       = 0
        plan_json["efficiency_breakdown"]   = {}
        plan_json["efficiency_motivations"] = []

    return plan_json
