"""
PlannerEngine Bridge — Adattatore tra i modelli ORM e il PlannerEngine deterministico.

Converte:
  ORM (Ticket, Tecnico, Asset) → PlannerTecnico / PlannerTicket
  PlannerResult              → plan_json (formato identico al motore AI)

Uso:
  from backend.services.planner_engine_bridge import generate_deterministic_plan
  plan_json = await generate_deterministic_plan(db, days=7, tenant_id=1)
"""
from __future__ import annotations

import re
import logging
from datetime import date as date_type, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from backend.db.modelli import Asset, Tecnico, Ticket
from backend.services.planner_engine import (
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

def _split_competenze(raw: Optional[str]) -> List[str]:
    """Split stringa competenze (virgola/spazio/punto-e-virgola) → lista uppercase."""
    if not raw:
        return []
    parts = re.split(r"[,;\s]+", raw.strip())
    return [p.strip().upper() for p in parts if p.strip()]


# Tipi di manutenzione standard: ogni tecnico attivo può eseguire qualsiasi tipo.
# In MaintAI le competenze sono job-skills (Meccanico, Elettricista…), non categorie
# di manutenzione (PM/CM/BD). Aggiungiamo i tipi standard come competenze implicite
# così il PlannerEngine non scarta tutti i ticket per REASON_NO_SKILL.
_TIPO_IMPLICITI = ["PM", "CM", "BD", "TUTTI"]


def _build_planner_tecnici(tecnici: List[Tecnico]) -> List[PlannerTecnico]:
    result = []
    for t in tecnici:
        if t.stato.lower() not in ("in servizio", "in_servizio"):
            continue
        comp = _split_competenze(t.competenze)
        # Aggiungi tipi manutenzione impliciti se non già presenti
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
        ))
    return result


def _build_planner_tickets(
    tickets: List[Ticket],
    asset_map: Dict[int, Asset],
) -> List[PlannerTicket]:
    result = []
    for t in tickets:
        asset = asset_map.get(t.asset_id) if t.asset_id else None
        impianto_id: Optional[int] = None
        area: Optional[str] = None
        if asset:
            impianto_id = asset.impianto_id
            area = asset.area

        result.append(PlannerTicket(
            id=t.id,
            impianto_id=impianto_id,
            priorita=t.priorita or "Media",
            tipo=t.tipo or "CM",
            durata_stimata_ore=float(t.durata_stimata_ore or 2.0),
            competenza_richiesta=None,   # usa tipo come proxy (BD/PM/CM)
            splittabile=True,
            area=area,
        ))
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

    # ── Carica ticket pianificabili ───────────────────────────────────────────
    ticket_query = db.query(Ticket).filter(
        Ticket.stato.in_(["Aperto", "Pianificato"])
    )
    if tenant_id:
        ticket_query = ticket_query.filter(Ticket.tenant_id == tenant_id)
    if asset_ids:
        ticket_query = ticket_query.filter(Ticket.asset_id.in_(asset_ids))
    tickets = ticket_query.all()

    # ── Carica tecnici attivi ─────────────────────────────────────────────────
    tecnico_query = db.query(Tecnico).filter(Tecnico.stato == "in servizio")
    if tenant_id:
        tecnico_query = tecnico_query.filter(Tecnico.tenant_id == tenant_id)
    tecnici = tecnico_query.all()

    # ── Guardrail: backlog vuoto ──────────────────────────────────────────────
    if not tickets:
        return {
            "planned_workorders": [],
            "deferred_workorders": [],
            "fermo_assets": [],
            "global_warnings": ["Nessun ticket aperto o pianificato trovato nel sistema."],
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

    # ── Asset map per lookup O(1) ─────────────────────────────────────────────
    asset_ids_set = list({t.asset_id for t in tickets if t.asset_id})
    assets = db.query(Asset).filter(Asset.id.in_(asset_ids_set)).all()
    asset_map: Dict[int, Asset] = {a.id: a for a in assets}

    # ── Conversione ORM → strutture PlannerEngine ─────────────────────────────
    planner_tecnici = _build_planner_tecnici(tecnici)
    planner_tickets = _build_planner_tickets(tickets, asset_map)

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
        "PlannerEngine: avvio — %d ticket, %d tecnici, orizzonte %d giorni",
        len(planner_tickets), len(planner_tecnici), days,
    )

    try:
        engine = PlannerEngine(
            tecnici=planner_tecnici,
            tickets=planner_tickets,
            existing_assignments=[],
            today=today,
            horizon_days=days,
        )
        engine_result = engine.run()
    except Exception as exc:
        logger.error("PlannerEngine: eccezione durante run(): %s", exc, exc_info=True)
        return {"error": f"Errore motore deterministico: {exc}"}

    logger.info(
        "PlannerEngine: completato — %d assegnati, %d non assegnati",
        len(engine_result.assignments), len(engine_result.unassigned),
    )

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
        })

    # ── Converti Unassigned → deferred_workorders ─────────────────────────────
    deferred_workorders = []
    for u in engine_result.unassigned:
        reason_it = REASON_IT.get(u.reason_code, u.detail or u.reason_code)
        deferred_workorders.append({
            "wo_id":  u.ticket_id,
            "reason": reason_it,
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
