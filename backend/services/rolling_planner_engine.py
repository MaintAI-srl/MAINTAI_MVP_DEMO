"""
Rolling 7-Day Planning Engine per MaintAI.

Implementa la logica a orizzonte mobile definita in docs/rolling.md:
- Readiness Gate (valutazione preparazione ticket)
- Freeze Zones (FROZEN_24 / PROTECTED_48 / FLEXIBLE_72 / DYNAMIC_168)
- Insertion Score (valore operativo di inserimento)
- Disruption Cost (costo di spostamento/inserimento su ticket già pianificati)
- PM Protection (tutela delle preventive in scadenza)
- Rolling KPI (saturazione, compliance prevista, breakdown backlog)

NOTA SUI PROXY (docs/architecture.md — workaround espliciti):
I seguenti campi NON esistono nel DB reale (v2.2.0) e vengono derivati da campi
esistenti. Quando il modello verrà esteso, questi proxy andranno sostituiti con
i campi reali senza cambiare l'interfaccia pubblica del motore.

  priority_class  ← priorita (Alta→P1, Media→P2, Bassa→P3-P4) + tipo BD→P1 override
  rolling_type    ← tipo (BD→BREAKDOWN, PM→PM, CM→CORRECTIVE, default→CORRECTIVE)
  freeze_zone     ← planned_start vs datetime.now(utc)
  pm_protected    ← tipo=="PM" + prossima_scadenza (se disponibile) o stato=="Pianificato"
  materials_ready ← non valutabile → assunto True (no campo DB) — bottleneck non emesso
  permits_ready   ← non valutabile → assunto True (no campo DB)
  access_ready    ← non valutabile → assunto True (no campo DB)
  job_plan_ready  ← non valutabile → assunto True (no campo DB)
  skills_ready    ← valutabile: skill match contro lista tecnici attivi
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone, date as date_type
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# ── Costanti finestre temporali ───────────────────────────────────────────────

FROZEN_HOURS    = 24
PROTECTED_HOURS = 48
FLEXIBLE_HOURS  = 72
DYNAMIC_HOURS   = 168

# ── Soglie insertion_score - disruption_cost per zona ────────────────────────
# Più alta la soglia, più difficile che un ticket entri in quella fascia.
# rolling.md §14: "threshold_finestra più alto nelle zone protette"
THRESHOLD = {
    "FROZEN_24":    80,
    "PROTECTED_48": 50,
    "FLEXIBLE_72":  15,
    "DYNAMIC_168":  0,
}

# ── Proxy mappings (workaround documentati) ───────────────────────────────────
PRIORITA_TO_P: Dict[str, str] = {
    "Alta":   "P1",
    "Media":  "P2",
    "Bassa":  "P3",
}

TIPO_TO_ROLLING: Dict[str, str] = {
    "BD": "BREAKDOWN",
    "PM": "PM",
    "CM": "CORRECTIVE",
}

# ── Bottleneck codes (rolling.md §7.4) ───────────────────────────────────────
BOTTLENECK_SKILL_MISSING      = "SKILL_MISSING"
BOTTLENECK_DURATION_UNRELIABLE = "DURATION_UNRELIABLE"
# I seguenti non sono valutabili senza campi DB — riservati per futura estensione
BOTTLENECK_MATERIAL_MISSING   = "MATERIAL_MISSING"
BOTTLENECK_TOOL_MISSING       = "TOOL_MISSING"
BOTTLENECK_PERMIT_MISSING     = "PERMIT_MISSING"
BOTTLENECK_ACCESS_MISSING     = "ACCESS_MISSING"
BOTTLENECK_JOB_PLAN_MISSING   = "JOB_PLAN_MISSING"


# ── Strutture dati I/O ────────────────────────────────────────────────────────

@dataclass
class RollingTicketInput:
    """
    Dati minimi di un ticket per l'analisi rolling.
    Estratti dall'ORM da rolling_analysis_from_db().
    """
    ticket_id: int
    titolo: str
    tipo: str           # BD / PM / CM
    priorita: str       # Alta / Media / Bassa
    stato: str          # Aperto / Pianificato / ...
    durata_stimata_ore: Optional[float]
    planned_start: Optional[datetime]
    planned_finish: Optional[datetime]
    tecnico_id: Optional[int]
    area: Optional[str]
    impianto_id: Optional[int]
    asset_criticality: Optional[str]  # Bassa | Media | Alta
    prossima_scadenza: Optional[datetime]
    is_manual_plan: bool = False  # da AttivitaManutenzione se collegata


@dataclass
class TecnicoInput:
    """Dati tecnico minimi per skill check."""
    id: int
    competenze: List[str]   # lista competenze uppercase
    stato: str


@dataclass
class TicketRollingAnalysis:
    """Risultato dell'analisi rolling per un singolo ticket."""
    ticket_id: int
    titolo: str
    tipo: str
    rolling_type: str        # BREAKDOWN / PM / CORRECTIVE
    priorita: str
    priority_class: str      # P1 / P2 / P3 / P4 / P5
    planning_status: str     # READY / NOT_READY
    bottlenecks: List[str]
    freeze_zone: Optional[str]   # zona corrente se già schedulato (None se non pianificato)
    pm_protected: bool
    pm_protection_reason: str
    insertion_score: float
    disruption_cost: float
    net_value: float             # insertion_score - disruption_cost
    can_enter: Dict[str, bool]   # {zona: bool} — se il ticket può/potrebbe entrare
    notes: List[str]


@dataclass
class RollingAnalysisResult:
    """Risultato aggregato dell'analisi rolling su tutti i ticket."""
    analyses: List[TicketRollingAnalysis]
    ready_count: int
    not_ready_count: int
    frozen_count: int       # ticket nella fascia FROZEN
    protected_count: int
    flexible_count: int
    dynamic_count: int
    unscheduled_count: int
    pm_protected_count: int
    kpi: Dict[str, Any]
    warnings: List[str]


# ── Funzioni pure ─────────────────────────────────────────────────────────────

def _derive_priority_class(tipo: str, priorita: str) -> str:
    """
    Proxy: mappa priorita DB + tipo → P1-P5.
    BD è sempre P1 indipendentemente dalla priorità dichiarata.
    PM bassa è P4 (pianificate cicliche).
    """
    if tipo == "BD":
        return "P1"
    base = PRIORITA_TO_P.get(priorita, "P3")
    # PM bassa → P4 (attività ciclica pianificata, rolling.md §8.1 P4)
    if tipo == "PM" and priorita == "Bassa":
        return "P4"
    return base


def _derive_freeze_zone(planned_start: Optional[datetime], now: datetime) -> Optional[str]:
    """
    Calcola la freeze zone corrente di un ticket già pianificato.
    Restituisce None se il ticket non è ancora schedulato.
    """
    if not planned_start:
        return None
    # Normalizza timezone
    if planned_start.tzinfo is None:
        planned_start = planned_start.replace(tzinfo=timezone.utc)
    delta_hours = (planned_start - now).total_seconds() / 3600
    if delta_hours <= FROZEN_HOURS:
        return "FROZEN_24"
    elif delta_hours <= PROTECTED_HOURS:
        return "PROTECTED_48"
    elif delta_hours <= FLEXIBLE_HOURS:
        return "FLEXIBLE_72"
    else:
        return "DYNAMIC_168"


def _is_pm_protected(
    tipo: str,
    stato: str,
    prossima_scadenza: Optional[datetime],
    now: datetime,
    days_horizon: int = 7,
) -> tuple[bool, str]:
    """
    Determina se un ticket PM è protetto dalla logica rolling.
    Proxy: usa prossima_scadenza se disponibile, altrimenti protegge i PM già pianificati.
    """
    if tipo != "PM":
        return False, ""

    if prossima_scadenza:
        if prossima_scadenza.tzinfo is None:
            prossima_scadenza = prossima_scadenza.replace(tzinfo=timezone.utc)
        days_to_scadenza = (prossima_scadenza - now).days
        if days_to_scadenza <= days_horizon:
            return True, f"Scadenza imminente entro {max(0, days_to_scadenza)} giorni"
        if days_to_scadenza <= 0:
            return True, "Scadenza già superata — PM critico"

    if stato == "Pianificato":
        return True, "PM già pianificata — spostamento richiede override motivato"

    return False, ""


def _evaluate_readiness(
    ticket: RollingTicketInput,
    tecnici: List[TecnicoInput],
) -> tuple[str, List[str]]:
    """
    Valuta la readiness del ticket con i dati disponibili.
    Restituisce (planning_status, bottlenecks).

    Bottleneck valutabili con campi esistenti:
    - DURATION_UNRELIABLE: durata_stimata_ore assente o = 0
    - SKILL_MISSING: nessun tecnico attivo ha la competenza richiesta

    Bottleneck NON valutabili (campi mancanti nel DB): materials, permits, access, job_plan
    → assunti Ready per non bloccare falsamente i ticket. Nota documentata.
    """
    bottlenecks: List[str] = []

    # Check 1 — Durata credibile
    if not ticket.durata_stimata_ore or ticket.durata_stimata_ore <= 0:
        bottlenecks.append(BOTTLENECK_DURATION_UNRELIABLE)

    # Check 2 — Skill match contro tecnici attivi
    # Proxy: ticket.tipo è la competenza richiesta (BD/PM/CM) + bridge aggiunge impliciti
    required_skill = ticket.tipo.upper()
    tecnici_attivi = [t for t in tecnici if t.stato.lower() in ("in servizio", "in_servizio")]
    if tecnici_attivi:
        skill_ok = any(
            required_skill in [c.upper() for c in t.competenze]
            for t in tecnici_attivi
        )
        if not skill_ok:
            bottlenecks.append(BOTTLENECK_SKILL_MISSING)

    # Campi non valutabili — documentati come assunti READY
    # materials_ready, permits_ready, access_ready, job_plan_ready → nessun campo DB

    status = "NOT_READY" if bottlenecks else "READY"
    return status, bottlenecks


def _compute_insertion_score(
    ticket: RollingTicketInput,
    priority_class: str,
    pm_protected: bool,
) -> float:
    """
    Calcola l'insertion_score: valore operativo del ticket se inserito nel piano.
    rolling.md §13 — componenti: priorità, tipo, impatto, readiness, scadenza.

    Scala 0-100. Proxy su campi esistenti.
    """
    score = 0.0

    # Priorità (componente principale)
    p_base = {"P1": 85.0, "P2": 60.0, "P3": 35.0, "P4": 20.0, "P5": 10.0}
    score += p_base.get(priority_class, 30.0)

    # Bonus tipo
    if ticket.tipo == "BD":
        score += 10.0    # BD urgenza aggiuntiva
    elif ticket.tipo == "PM" and pm_protected:
        score += 8.0     # PM in scadenza ha valore elevato

    # Bonus durata reale (ticket brevi → più flessibili, ma non è un KPI diretto)
    # Non applicato — mancano campi asset_criticality, safety_impact, production_impact

    return min(score, 100.0)


def _compute_disruption_cost(
    ticket: RollingTicketInput,
    freeze_zone: Optional[str],
    pm_protected: bool,
) -> float:
    """
    Calcola il costo di disruption: danno causato dall'inserimento/spostamento.
    rolling.md §12 — proxy: zona temporale corrente e protezione PM.
    """
    if not freeze_zone:
        # Non ancora schedulato → nessun disruption
        return 0.0

    zone_cost = {
        "FROZEN_24":    90.0,
        "PROTECTED_48": 55.0,
        "FLEXIBLE_72":  20.0,
        "DYNAMIC_168":  5.0,
    }
    cost = zone_cost.get(freeze_zone, 0.0)

    # PM protetta in zona protetta → disruption aggiuntiva
    if pm_protected and freeze_zone in ("FROZEN_24", "PROTECTED_48"):
        cost += 15.0

    return min(cost, 100.0)


def _can_enter_zone(
    insertion_score: float,
    disruption_cost: float,
    zone: str,
    priority_class: str,
) -> bool:
    """
    Verifica se il ticket può entrare in una zona dato il suo net_value.
    rolling.md §13.3: insertion_score > disruption_cost + threshold_finestra
    """
    threshold = THRESHOLD.get(zone, 0)
    net = insertion_score - disruption_cost
    return net > threshold


# ── Funzione principale ───────────────────────────────────────────────────────

def run_rolling_analysis(
    tickets: List[RollingTicketInput],
    tecnici: List[TecnicoInput],
    now: Optional[datetime] = None,
    days_horizon: int = 7,
) -> RollingAnalysisResult:
    """
    Esegue l'analisi rolling su tutti i ticket forniti.
    Funzione pura: no ORM, no I/O. Testabile in isolamento.

    Args:
        tickets: lista ticket da analizzare (aperti + pianificati)
        tecnici: lista tecnici attivi per skill check
        now: timestamp corrente (default: datetime.now(utc))
        days_horizon: orizzonte giorni (default 7)

    Returns:
        RollingAnalysisResult con per-ticket analysis e KPI aggregati
    """
    if now is None:
        now = datetime.now(timezone.utc)

    analyses: List[TicketRollingAnalysis] = []
    warnings: List[str] = []

    counters = {
        "ready": 0, "not_ready": 0,
        "frozen": 0, "protected": 0, "flexible": 0, "dynamic": 0, "unscheduled": 0,
        "pm_protected": 0,
    }
    total_planned_ore = 0.0
    total_available_ore = 0.0

    # Stima ore disponibili totali (proxy: tecnici attivi × 8h × 5gg)
    tecnici_attivi = [t for t in tecnici if t.stato.lower() in ("in servizio", "in_servizio")]
    total_available_ore = len(tecnici_attivi) * 8 * min(days_horizon, 5)

    zones = ["FROZEN_24", "PROTECTED_48", "FLEXIBLE_72", "DYNAMIC_168"]

    for ticket in tickets:
        tipo = ticket.tipo or "CM"
        priorita = ticket.priorita or "Media"
        rolling_type = TIPO_TO_ROLLING.get(tipo, "CORRECTIVE")
        priority_class = _derive_priority_class(tipo, priorita)

        # Freeze zone corrente (se già pianificato)
        freeze_zone = _derive_freeze_zone(ticket.planned_start, now)

        # Readiness
        planning_status, bottlenecks = _evaluate_readiness(ticket, tecnici)

        # PM Protection
        pm_protected, pm_reason = _is_pm_protected(
            tipo, ticket.stato, ticket.prossima_scadenza, now, days_horizon
        )

        # Scores
        ins_score = _compute_insertion_score(ticket, priority_class, pm_protected)
        dis_cost  = _compute_disruption_cost(ticket, freeze_zone, pm_protected)
        net_value = ins_score - dis_cost

        # Can-enter per ogni zona
        can_enter = {
            zone: _can_enter_zone(ins_score, dis_cost, zone, priority_class)
            for zone in zones
        }

        # Note operative
        notes: List[str] = []
        if tipo == "BD" and freeze_zone is None:
            notes.append("BD non pianificato: pianificare immediatamente nella prima fascia disponibile")
        if pm_protected and freeze_zone in ("PROTECTED_48", "FROZEN_24"):
            notes.append("PM protetta in fascia critica: richiedere override motivato per spostare")
        if planning_status == "NOT_READY":
            notes.append(f"Ticket NOT READY — bottleneck: {', '.join(bottlenecks)}")
        if ticket.durata_stimata_ore and ticket.durata_stimata_ore > 0:
            total_planned_ore += ticket.durata_stimata_ore if ticket.stato == "Pianificato" else 0

        analyses.append(TicketRollingAnalysis(
            ticket_id=ticket.ticket_id,
            titolo=ticket.titolo or f"Ticket #{ticket.ticket_id}",
            tipo=tipo,
            rolling_type=rolling_type,
            priorita=priorita,
            priority_class=priority_class,
            planning_status=planning_status,
            bottlenecks=bottlenecks,
            freeze_zone=freeze_zone,
            pm_protected=pm_protected,
            pm_protection_reason=pm_reason,
            insertion_score=round(ins_score, 1),
            disruption_cost=round(dis_cost, 1),
            net_value=round(net_value, 1),
            can_enter=can_enter,
            notes=notes,
        ))

        # Counters
        if planning_status == "READY":
            counters["ready"] += 1
        else:
            counters["not_ready"] += 1
        if pm_protected:
            counters["pm_protected"] += 1
        if freeze_zone == "FROZEN_24":
            counters["frozen"] += 1
        elif freeze_zone == "PROTECTED_48":
            counters["protected"] += 1
        elif freeze_zone == "FLEXIBLE_72":
            counters["flexible"] += 1
        elif freeze_zone == "DYNAMIC_168":
            counters["dynamic"] += 1
        else:
            counters["unscheduled"] += 1

    # Warnings aggregati
    if counters["not_ready"] > 0:
        warnings.append(
            f"{counters['not_ready']} ticket NOT READY — verificare bottleneck prima di schedulare"
        )
    bd_unscheduled = [a for a in analyses if a.tipo == "BD" and a.freeze_zone is None]
    if bd_unscheduled:
        warnings.append(
            f"{len(bd_unscheduled)} Breakdown non pianificati: richiedono inserimento immediato"
        )
    pm_late = [a for a in analyses if a.pm_protected and a.freeze_zone is None]
    if pm_late:
        warnings.append(
            f"{len(pm_late)} PM protette non ancora schedulate entro l'orizzonte"
        )

    # KPI
    saturazione = round((total_planned_ore / total_available_ore * 100), 1) if total_available_ore else 0
    p1_scheduled = sum(1 for a in analyses if a.priority_class == "P1" and a.freeze_zone is not None)
    p1_total = sum(1 for a in analyses if a.priority_class == "P1")
    compliance_prevista = round((p1_scheduled / p1_total * 100), 1) if p1_total else 100.0

    bd_count = sum(1 for a in analyses if a.tipo == "BD")
    pm_count = sum(1 for a in analyses if a.tipo == "PM")
    cm_count = sum(1 for a in analyses if a.tipo not in ("BD", "PM"))
    total = len(analyses)

    kpi: Dict[str, Any] = {
        "ore_disponibili_stimate": total_available_ore,
        "ore_pianificate": round(total_planned_ore, 1),
        "saturazione_pct": saturazione,
        "backlog_ready": counters["ready"],
        "backlog_not_ready": counters["not_ready"],
        "pm_protette": counters["pm_protected"],
        "ticket_frozen": counters["frozen"],
        "ticket_protected": counters["protected"],
        "ticket_flexible": counters["flexible"],
        "ticket_dynamic": counters["dynamic"],
        "ticket_unscheduled": counters["unscheduled"],
        "compliance_prevista_pct": compliance_prevista,
        "pct_breakdown": round(bd_count / total * 100, 1) if total else 0,
        "pct_pm": round(pm_count / total * 100, 1) if total else 0,
        "pct_cm": round(cm_count / total * 100, 1) if total else 0,
        "note": [
            "ore_disponibili_stimate basate su tecnici_attivi × 8h × 5gg (proxy)",
            "saturazione_pct calcolata solo su ticket già in stato Pianificato",
            "materials_ready/permits_ready/access_ready non valutabili senza campi DB — assunti True",
        ],
    }

    logger.info(
        "RollingAnalysis: %d ticket analizzati — %d READY, %d NOT_READY, "
        "%d frozen, %d protected, %d flexible, %d dynamic, %d unscheduled",
        len(analyses),
        counters["ready"], counters["not_ready"],
        counters["frozen"], counters["protected"],
        counters["flexible"], counters["dynamic"],
        counters["unscheduled"],
    )

    return RollingAnalysisResult(
        analyses=analyses,
        ready_count=counters["ready"],
        not_ready_count=counters["not_ready"],
        frozen_count=counters["frozen"],
        protected_count=counters["protected"],
        flexible_count=counters["flexible"],
        dynamic_count=counters["dynamic"],
        unscheduled_count=counters["unscheduled"],
        pm_protected_count=counters["pm_protected"],
        kpi=kpi,
        warnings=warnings,
    )
