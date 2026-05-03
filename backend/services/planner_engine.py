"""
Planner Engine — Motore deterministico di scheduling manutenzione.

Lavora SOLO su strutture dati Python (nessuna dipendenza DB/ORM diretta),
per facilitare testing unitario isolato.

INPUT TYPES: PlannerTecnico, PlannerTicket, PlannerAssignment
OUTPUT: PlannerResult con assignments, unassigned, explanation_log
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from typing import Dict, List, Optional, Tuple
import logging

logger = logging.getLogger(__name__)

# ── Reason Codes ──────────────────────────────────────────────────────────────

REASON_NO_SKILL              = "NO_SKILL"
REASON_NO_AVAILABILITY       = "NO_AVAILABILITY"
REASON_TIME_WINDOW_CONFLICT  = "TIME_WINDOW_CONFLICT"
REASON_CAPACITY_EXCEEDED     = "CAPACITY_EXCEEDED"
REASON_LIMITATION_MISMATCH   = "LIMITATION_MISMATCH"
REASON_MULTI_TECH_NOT_FOUND  = "MULTI_TECH_NOT_FOUND"

REASON_PRIORITY = [
    REASON_NO_SKILL,
    REASON_LIMITATION_MISMATCH,
    REASON_TIME_WINDOW_CONFLICT,
    REASON_MULTI_TECH_NOT_FOUND,
    REASON_CAPACITY_EXCEEDED,
    REASON_NO_AVAILABILITY,
]


# ── Input Data Structures ─────────────────────────────────────────────────────

@dataclass
class PlannerTecnico:
    id: int
    nome: str
    stato: str                       # "in_servizio" = attivo
    competenze: List[str]            # ["PM", "CM", "BD", ...]
    ore_giornaliere: int             # ore disponibili al giorno
    orario_inizio: str = "08:00"     # HH:MM
    orario_fine: str = "17:00"       # HH:MM
    limitazioni: List[str] = field(default_factory=list)
    area: Optional[str] = None                       # può mancare (campo non presente in DB)
    impianti_abilitati: List[int] = field(default_factory=list)  # può essere vuoto = tutti
    # Workaround: giorni non disponibili per assenza (ferie, malattia, ecc.)
    # Caricati dal bridge via TecnicoAssenza; il motore li esclude dalla pianificazione.
    giorni_assenza: List[date] = field(default_factory=list)


@dataclass
class PlannerTicket:
    id: int
    impianto_id: Optional[int]
    priorita: str                     # "Alta" | "Media" | "Bassa"
    tipo: str                         # "BD" | "PM" | "CM"
    durata_stimata_ore: float
    competenza_richiesta: Optional[str] = None   # se None → usa tipo come proxy
    finestra_inizio: Optional[date] = None       # None = senza vincolo
    finestra_fine: Optional[date] = None         # None = senza vincolo
    limitazioni: List[str] = field(default_factory=list)
    area: Optional[str] = None
    tecnici_richiesti: int = 1            # quanti tecnici in contemporanea (default 1)
    splittabile: bool = True              # se True: può essere spezzato su più giorni
    scadenza_sla: Optional[date] = None  # None = nessuna scadenza SLA
    eta_giorni: int = 0                  # giorni dalla creazione (per aging score)
    giorni_non_operativi: List[date] = field(default_factory=list)  # giorni di fermo asset


@dataclass
class PlannerAssignment:
    """Assegnazione esistente (locked o meno)."""
    ticket_id: int
    tecnico_id: int
    start: datetime
    end: datetime
    locked: bool = False


# ── Output Data Structures ────────────────────────────────────────────────────

@dataclass
class Assignment:
    ticket_id: int
    tecnico_id: int
    start: datetime
    end: datetime
    is_continuation: bool = False
    parent_ticket_id: Optional[int] = None


@dataclass
class Unassigned:
    ticket_id: int
    reason_code: str
    detail: str = ""
    earliest_possible_date: Optional[str] = None


@dataclass
class PlannerResult:
    assignments: List[Assignment] = field(default_factory=list)
    unassigned: List[Unassigned] = field(default_factory=list)
    explanation_log: List[str] = field(default_factory=list)


# ── Helper Functions ──────────────────────────────────────────────────────────

def _parse_time(t_str: str, fallback: time = time(8, 0)) -> time:
    """
    Converte 'HH:MM' in datetime.time.
    Se il formato è invalido restituisce il fallback (default 08:00)
    per evitare crash su configurazioni malformate dei tecnici.
    """
    try:
        parts = t_str.split(":")
        return time(int(parts[0]), int(parts[1]))
    except (ValueError, IndexError, AttributeError):
        logger.warning("_parse_time: formato invalido '%s', uso fallback %s", t_str, fallback)
        return fallback


def _priorita_score(p: str) -> int:
    return {"alta": 3, "media": 2, "bassa": 1}.get(p.lower(), 1)


def _tipo_score(t: str) -> int:
    return {"bd": 3, "cm": 2, "pm": 1}.get(t.lower(), 1)


def _sla_key(t: PlannerTicket) -> date:
    """Per ordinamento: SLA più vicino = più urgente. None → messo in fondo."""
    return t.scadenza_sla or date(9999, 12, 31)


def _ticket_priority_score(ticket: PlannerTicket, today: date) -> float:
    """
    Score di priorità composito per ordinamento ticket (#2).

    Componenti:
    - tipo_peso: BD=1000, CM=200, PM=100
    - prio_peso: Alta=300, Media=100, Bassa=30
    - sla_score: urgenza basata su giorni alla scadenza SLA
    - aging_score: ticket vecchi guadagnano urgenza (max 100)
    """
    tipo_peso = {"BD": 1000, "CM": 200, "PM": 100, "ISP": 50}.get(ticket.tipo.upper() if ticket.tipo else "", 100)
    prio_peso = {"Alta": 300, "Media": 100, "Bassa": 30}.get(ticket.priorita, 100)

    sla_score = 0
    if ticket.scadenza_sla:
        giorni_alla_scadenza = (ticket.scadenza_sla - today).days
        if giorni_alla_scadenza <= 0:
            sla_score = 500
        elif giorni_alla_scadenza <= 3:
            sla_score = 300
        elif giorni_alla_scadenza <= 7:
            sla_score = 150

    aging_score = min(ticket.eta_giorni * 2, 100)

    return float(tipo_peso + prio_peso + sla_score + aging_score)


def _find_earliest_date(
    ticket: PlannerTicket,
    technicians: List[PlannerTecnico],
    from_date: date,
    days_lookahead: int = 14,
    hierarchy: Dict[str, List[str]] | None = None,
) -> Optional[str]:
    """
    Trova la prima data in cui un tecnico ha disponibilità per questo ticket (#7).
    Semplificato: non verifica il carico esistente, solo assenze e skill match.
    """
    for delta in range(days_lookahead):
        candidate = from_date + timedelta(days=delta)
        if candidate.weekday() >= 5:  # skip weekend
            continue
        # Salta giorni non operativi dell'asset
        if candidate in ticket.giorni_non_operativi:
            continue
        for tech in technicians:
            if tech.stato.lower() not in ("in_servizio", "in servizio"):
                continue
            if candidate in tech.giorni_assenza:
                continue
            # Verifica skill match
            needed = _competenza_richiesta(ticket)
            if not _skill_covers(needed, tech.competenze, hierarchy):
                continue
            if tech.ore_giornaliere <= 0:
                continue
            if not ticket.splittabile and tech.ore_giornaliere < ticket.durata_stimata_ore:
                continue
            return candidate.isoformat()
    return None


def _competenza_richiesta(ticket: PlannerTicket) -> str:
    """Ritorna la competenza richiesta: usa il campo se presente, altrimenti tipo."""
    if ticket.competenza_richiesta:
        return ticket.competenza_richiesta.strip().upper()
    return ticket.tipo.strip().upper()


def _skill_covers(
    required: str,
    tech_skills: List[str],
    hierarchy: Dict[str, List[str]] | None = None,
) -> bool:
    """
    Verifica se le competenze del tecnico coprono la competenza richiesta.

    Supporta gerarchia opzionale: se `hierarchy` è fornita, una competenza
    "superiore" nel tecnico può coprire una richiesta "inferiore".
    Esempio: hierarchy={"SENIOR_MECH": ["MECCANICO"]} → un tecnico
    SENIOR_MECH soddisfa un ticket che richiede MECCANICO.

    Senza gerarchia (default) il check è una semplice inclusione.
    Workaround esplicito: la gerarchia reale sarà configurabile dal
    responsabile manutenzione in una futura versione con campo DB dedicato.
    """
    req = required.strip().upper()
    normalized = [s.strip().upper() for s in tech_skills]

    if req in normalized:
        return True

    if hierarchy:
        # Cerca se una competenza del tecnico copre req tramite la gerarchia
        for tech_skill in normalized:
            covered = hierarchy.get(tech_skill, [])
            if req in [c.upper() for c in covered]:
                return True

    return False


def _has_limitation_mismatch(ticket_lims: List[str], tecnico_lims: List[str]) -> bool:
    """
    Verifica se c'è un conflitto esplicito tra le limitazioni del ticket e del tecnico.
    Logica semplice: se una limitazione del ticket compare come negazione nel tecnico
    (es. ticket richiede "notturno" ma tecnico ha "no_notturno"), → mismatch.
    """
    tecnico_lims_lower = [l.lower() for l in tecnico_lims]
    for l in ticket_lims:
        neg = f"no_{l.lower()}"
        if neg in tecnico_lims_lower:
            return True
    return False


def _ore_start_di_giorno(orario_inizio: str) -> float:
    """Converte orario_inizio (HH:MM) in ore float dal mezzanotte."""
    t = _parse_time(orario_inizio)
    return t.hour + t.minute / 60.0


def _datetime_for(d: date, ore_float: float) -> datetime:
    """Crea un datetime da una date e ore float (es. 8.5 = 08:30)."""
    h = int(ore_float)
    m = int(round((ore_float - h) * 60))
    return datetime(d.year, d.month, d.day, h, m)


# ── Core Engine ───────────────────────────────────────────────────────────────

import math as _math


def _slots_needed(durata_ore: float, slot_minutes: int) -> int:
    """Numero di slot da occupare per una data durata. Arrotonda per eccesso."""
    return _math.ceil(durata_ore * 60 / slot_minutes)


def _find_free_block(grid: List[bool], slots_needed: int) -> Optional[int]:
    """
    Trova il primo indice di blocco consecutivo libero nel grid degli slot.
    Ritorna l'indice iniziale, oppure None se non trovato.
    """
    n = len(grid)
    count = 0
    start = 0
    for i in range(n):
        if not grid[i]:
            if count == 0:
                start = i
            count += 1
            if count >= slots_needed:
                return start
        else:
            count = 0
    return None


def _slot_to_ore_float(slot_idx: int, orario_inizio: str, slot_minutes: int) -> float:
    """Converte indice slot → ore float dal mezzanotte."""
    t = _parse_time(orario_inizio)
    start_float = t.hour + t.minute / 60.0
    return start_float + slot_idx * slot_minutes / 60.0


class PlannerEngine:
    """
    Motore deterministico di scheduling.
    Utilizza greedy scheduling con scoring soft-rules.

    Se slot_minutes è specificato (es. 30), il tracking della capacità
    avviene a slot di quella granularità anziché a ore float giornaliere.
    Backward compat: se slot_minutes is None, usa il vecchio tracking a float.
    """

    def __init__(
        self,
        tecnici: List[PlannerTecnico],
        tickets: List[PlannerTicket],
        existing_assignments: List[PlannerAssignment],
        today: date,
        horizon_days: int = 7,
        skill_hierarchy: Dict[str, List[str]] | None = None,
        slot_minutes: int | None = None,
    ):
        self.slot_minutes = slot_minutes
        self.skill_hierarchy = skill_hierarchy
        self.tecnici = tecnici
        self.tickets = tickets
        self.existing_assignments = existing_assignments
        self.today = today
        self.horizon_days = horizon_days

        # Orizzonte di pianificazione
        self.horizon: List[date] = [today + timedelta(days=i) for i in range(horizon_days)]

        # Tecnici attivi
        self.tecnici_attivi = [t for t in tecnici if t.stato.lower() in ("in_servizio", "in servizio")]

        if slot_minutes is not None:
            # ── Tracking a slot ───────────────────────────────────────────────
            # slot_grid[tecnico_id][giorno] = List[bool] (True=occupato)
            self.slot_grid: Dict[int, Dict[date, List[bool]]] = {}
            for t in tecnici:
                n_slots = _math.ceil(t.ore_giornaliere * 60 / slot_minutes)
                self.slot_grid[t.id] = {d: [False] * n_slots for d in self.horizon}
            # Compatibilità: ore_consumate come vista derivata (usata da score())
            self.ore_consumate: Dict[int, Dict[date, float]] = {
                t.id: {d: 0.0 for d in self.horizon} for t in tecnici
            }
            # Pre-popola assenze bloccando tutti gli slot del giorno
            for t in tecnici:
                for giorno in t.giorni_assenza:
                    if giorno in self.slot_grid.get(t.id, {}):
                        n = len(self.slot_grid[t.id][giorno])
                        self.slot_grid[t.id][giorno] = [True] * n
                        self.ore_consumate[t.id][giorno] = float(t.ore_giornaliere)
        else:
            # ── Tracking a ore float (legacy) ─────────────────────────────────
            self.slot_grid = {}  # type: ignore[assignment]
            self.ore_consumate = {
                t.id: {d: 0.0 for d in self.horizon} for t in tecnici
            }
            # Pre-popola assenze saturando ore_consumate
            for t in tecnici:
                for giorno in t.giorni_assenza:
                    if giorno in self.ore_consumate.get(t.id, {}):
                        self.ore_consumate[t.id][giorno] = float(t.ore_giornaliere)

        # Impianti per tecnico già attivi oggi (per soft-rule impianto)
        # impianto_tecnico_day[(impianto_id, tecnico_id, giorno)] = True
        self._impianto_cache: Dict[Tuple, bool] = {}

    def run(self) -> PlannerResult:
        result = PlannerResult()

        # ── FASE 0: Pre-carica assegnazioni locked ────────────────────────────
        locked_ticket_ids: set = set()
        for a in self.existing_assignments:
            if a.locked:
                locked_ticket_ids.add(a.ticket_id)
                giorno = a.start.date()
                durata = (a.end - a.start).total_seconds() / 3600.0
                if self.slot_minutes is not None:
                    # Slot mode: occupa i slot corrispondenti
                    if a.tecnico_id in self.slot_grid and giorno in self.slot_grid[a.tecnico_id]:
                        grid = self.slot_grid[a.tecnico_id][giorno]
                        sm = self.slot_minutes
                        t_obj = next((t for t in self.tecnici if t.id == a.tecnico_id), None)
                        if t_obj:
                            start_ore = _ore_start_di_giorno(t_obj.orario_inizio)
                            start_delta = (a.start.hour + a.start.minute / 60.0) - start_ore
                            slot_start = max(0, int(start_delta * 60 / sm))
                            slots_n = _slots_needed(durata, sm)
                            for s in range(slot_start, min(slot_start + slots_n, len(grid))):
                                grid[s] = True
                        self.ore_consumate[a.tecnico_id][giorno] = sum(1 for s in self.slot_grid[a.tecnico_id][giorno] if s) * sm / 60.0
                else:
                    if a.tecnico_id in self.ore_consumate and giorno in self.ore_consumate[a.tecnico_id]:
                        self.ore_consumate[a.tecnico_id][giorno] += durata
                result.explanation_log.append(
                    f"[LOCKED] Ticket #{a.ticket_id} → Tecnico #{a.tecnico_id} il {giorno} ({durata:.1f}h)"
                )

        # ── FASE 1: Ordina ticket per score composito (#2) ───────────────────
        to_schedule = [t for t in self.tickets if t.id not in locked_ticket_ids]
        to_schedule.sort(key=lambda t: -_ticket_priority_score(t, self.today))

        # ── FASE 2: Scheduling greedy ─────────────────────────────────────────
        for ticket in to_schedule:
            self._schedule_ticket(ticket, result)

        return result

    def _schedule_ticket(self, ticket: PlannerTicket, result: PlannerResult) -> None:
        """Tenta di allocare il ticket. Appende assignment o unassigned."""

        # Raccoglie tutti (tecnico, giorno) candidati validi
        candidati: List[Tuple[PlannerTecnico, date, float]] = []  # (tecnico, giorno, ore_libere)
        failure_reasons: set = set()

        # Pre-check: se la finestra del ticket è completamente fuori dall'orizzonte
        if ticket.finestra_inizio and ticket.finestra_inizio > self.horizon[-1]:
            failure_reasons.add(REASON_TIME_WINDOW_CONFLICT)
        if ticket.finestra_fine and ticket.finestra_fine < self.horizon[0]:
            failure_reasons.add(REASON_TIME_WINDOW_CONFLICT)

        days_in_window = 0  # conta quanti giorni superano il check della finestra temporale

        for giorno in self.horizon:
            # Verifica finestra temporale
            if ticket.finestra_inizio and giorno < ticket.finestra_inizio:
                continue  # Non aggiungere TIME_WINDOW_CONFLICT qui: conta solo i giorni
            if ticket.finestra_fine and giorno > ticket.finestra_fine:
                continue
            days_in_window += 1

            for tecnico in self.tecnici_attivi:
                # HARD: skill check (con supporto gerarchia opzionale)
                comp = _competenza_richiesta(ticket)
                if not _skill_covers(comp, tecnico.competenze, self.skill_hierarchy):
                    failure_reasons.add(REASON_NO_SKILL)
                    continue

                # HARD: limitazioni
                if _has_limitation_mismatch(ticket.limitazioni, tecnico.limitazioni):
                    failure_reasons.add(REASON_LIMITATION_MISMATCH)
                    continue

                # HARD: impianti abilitati (se lista non vuota, tecnico deve avere impianto)
                if tecnico.impianti_abilitati and ticket.impianto_id:
                    if ticket.impianto_id not in tecnico.impianti_abilitati:
                        failure_reasons.add(REASON_NO_AVAILABILITY)
                        continue

                # HARD: capacità
                ore_libere = self._ore_libere(tecnico, giorno)
                if ore_libere <= 0:
                    failure_reasons.add(REASON_CAPACITY_EXCEEDED)
                    continue

                candidati.append((tecnico, giorno, ore_libere))

        # Se nessun giorno era dentro la finestra temporale, è un TIME_WINDOW_CONFLICT
        if days_in_window == 0:
            failure_reasons.add(REASON_TIME_WINDOW_CONFLICT)


        if not candidati:
            reason = self._pick_reason(failure_reasons)
            # Calcola earliest_possible_date oltre l'orizzonte corrente (#7)
            earliest = _find_earliest_date(
                ticket=ticket,
                technicians=self.tecnici_attivi,
                from_date=self.today,
                days_lookahead=21,
                hierarchy=self.skill_hierarchy,
            )
            result.unassigned.append(Unassigned(
                ticket_id=ticket.id,
                reason_code=reason,
                detail=f"Nessun tecnico/giorno valido trovato (motivi: {failure_reasons})",
                earliest_possible_date=earliest,
            ))
            result.explanation_log.append(
                f"[SKIP] Ticket #{ticket.id} ({ticket.tipo}/{ticket.priorita}) → {reason}"
            )
            return

        # ── SOFT SCORING ──────────────────────────────────────────────────────
        def score(entry: Tuple[PlannerTecnico, date, float]) -> float:
            tecnico, giorno, ore_libere = entry
            s = 0.0
            # Tecnico già attivo sullo stesso impianto oggi
            if ticket.impianto_id and self._impianto_cache.get((ticket.impianto_id, tecnico.id, giorno)):
                s += 3.0
            # Saturazione ottimale (più ore già usate → più saturo → meglio per riempire giornata)
            usate = self.ore_consumate[tecnico.id].get(giorno, 0.0)
            saturazione = usate / max(tecnico.ore_giornaliere, 1)
            s += saturazione * 2.0
            # Area compatibile (se disponibile)
            if tecnico.area and ticket.area and tecnico.area == ticket.area:
                s += 1.0
            return s

        candidati.sort(key=score, reverse=True)

        # Prova a schedulare dal miglior candidato
        for tecnico, giorno_start, _ in candidati:
            done = self._try_allocate(ticket, tecnico, giorno_start, result)
            if done:
                return

        # Se arriva qui, nessuna allocazione riuscita
        result.unassigned.append(Unassigned(
            ticket_id=ticket.id,
            reason_code=REASON_CAPACITY_EXCEEDED,
            detail="Tutti i candidati validi hanno fallito l'allocazione concreta.",
        ))

    def _ore_libere(self, tecnico: PlannerTecnico, giorno: date) -> float:
        """Ore libere del tecnico nel giorno. Gestisce entrambe le modalità tracking."""
        if self.slot_minutes is not None:
            grid = self.slot_grid.get(tecnico.id, {}).get(giorno, [])
            liberi = sum(1 for s in grid if not s)
            return liberi * self.slot_minutes / 60.0
        return tecnico.ore_giornaliere - self.ore_consumate[tecnico.id].get(giorno, 0.0)

    def _commit_allocation(self, tecnico: PlannerTecnico, giorno: date, durata: float, assignment: Assignment) -> None:
        """Registra un'allocazione nelle strutture di tracking (ore_consumate e/o slot_grid)."""
        if self.slot_minutes is not None:
            grid = self.slot_grid.get(tecnico.id, {}).get(giorno)
            if grid is not None:
                sm = self.slot_minutes
                start_ore = _ore_start_di_giorno(tecnico.orario_inizio)
                start_delta = (assignment.start.hour + assignment.start.minute / 60.0) - start_ore
                slot_start = max(0, int(round(start_delta * 60 / sm)))
                slots_n = _slots_needed(durata, sm)
                for s in range(slot_start, min(slot_start + slots_n, len(grid))):
                    grid[s] = True
            # Aggiorna anche ore_consumate come vista derivata
            if tecnico.id in self.ore_consumate and giorno in self.ore_consumate[tecnico.id]:
                self.ore_consumate[tecnico.id][giorno] += durata
        else:
            if tecnico.id in self.ore_consumate and giorno in self.ore_consumate[tecnico.id]:
                self.ore_consumate[tecnico.id][giorno] += durata

    def _try_allocate(
        self,
        ticket: PlannerTicket,
        tecnico: PlannerTecnico,
        giorno_start: date,
        result: PlannerResult,
    ) -> bool:
        """
        Tenta di allocare il ticket a partire da giorno_start.
        Se splittabile, usa più giorni. Ritorna True se riuscito.
        Supporta tracking a slot (slot_minutes) e tracking a ore float (legacy).
        """
        durata_totale = ticket.durata_stimata_ore
        ore_libere_d0 = self._ore_libere(tecnico, giorno_start)

        # Caso semplice: entra tutto nel primo giorno
        if durata_totale <= ore_libere_d0:
            a = self._make_assignment(ticket, tecnico, giorno_start, durata_totale, is_cont=False)
            result.assignments.append(a)
            self._commit_allocation(tecnico, giorno_start, durata_totale, a)
            self._mark_impianto(ticket.impianto_id, tecnico.id, giorno_start)
            result.explanation_log.append(
                f"[OK] Ticket #{ticket.id} → Tecnico #{tecnico.id} il {giorno_start} "
                f"({durata_totale:.1f}h, {a.start.strftime('%H:%M')}-{a.end.strftime('%H:%M')})"
            )
            return True

        # Ticket NON splittabile: cerca un giorno con abbastanza ore libere
        if not ticket.splittabile:
            for giorno in self.horizon:
                if giorno < giorno_start:
                    continue
                # Salta giorni non operativi dell'asset (#8)
                if giorno in ticket.giorni_non_operativi:
                    continue
                ore_libere = self._ore_libere(tecnico, giorno)
                if ore_libere >= durata_totale:
                    a = self._make_assignment(ticket, tecnico, giorno, durata_totale, is_cont=False)
                    result.assignments.append(a)
                    self._commit_allocation(tecnico, giorno, durata_totale, a)
                    self._mark_impianto(ticket.impianto_id, tecnico.id, giorno)
                    result.explanation_log.append(
                        f"[OK-NOSP] Ticket #{ticket.id} → Tecnico #{tecnico.id} il {giorno} "
                        f"({durata_totale:.1f}h complessive)"
                    )
                    return True
            return False  # nessun giorno con abbastanza ore libere

        # Ticket splittabile: frammenta su più giorni contigui.
        # Regola: stesso tecnico preferito; se non disponibile nel giorno di continuazione,
        # si cerca il primo tecnico alternativo qualificato con ore libere per quel giorno.
        # I frammenti NON si sovrappongono mai: ogni frammento occupa la prima fascia
        # libera del giorno assegnato, calcolata via ore_consumate al momento del commit.
        ore_rimanenti = durata_totale
        primo = True
        fragments: List[Assignment] = []
        # (tecnico, giorno, da_allocare) → da committare insieme dopo
        commit_queue: List[Tuple] = []
        tecnici_usati_per_split: Dict[date, PlannerTecnico] = {}  # giorno → tecnico effettivo

        for giorno in self.horizon:
            if giorno < giorno_start:
                continue
            if ore_rimanenti <= 0:
                break

            # Salta giorni non operativi dell'asset (#8)
            if giorno in ticket.giorni_non_operativi:
                continue

            # Calcola ore libere del tecnico primario
            ore_libere_primario = self._ore_libere(tecnico, giorno)

            if ore_libere_primario > 0:
                tecnico_giorno = tecnico
                ore_libere = ore_libere_primario
            elif not primo:
                # Primo frammento già allocato: cerca alternativa per le continuazioni
                tecnico_giorno = None
                ore_libere = 0.0
                comp = _competenza_richiesta(ticket)
                for alt in self.tecnici_attivi:
                    if alt.id == tecnico.id:
                        continue
                    if not _skill_covers(comp, alt.competenze, self.skill_hierarchy):
                        continue
                    if _has_limitation_mismatch(ticket.limitazioni, alt.limitazioni):
                        continue
                    alt_ore = self._ore_libere(alt, giorno)
                    if alt_ore > 0:
                        tecnico_giorno = alt
                        ore_libere = alt_ore
                        break
                if tecnico_giorno is None:
                    continue
            else:
                continue

            da_allocare = min(ore_rimanenti, ore_libere)
            a = self._make_assignment(
                ticket, tecnico_giorno, giorno, da_allocare,
                is_cont=not primo,
                parent_id=ticket.id if not primo else None,
            )
            fragments.append(a)
            commit_queue.append((tecnico_giorno, giorno, da_allocare, a))
            tecnici_usati_per_split[giorno] = tecnico_giorno
            ore_rimanenti -= da_allocare
            primo = False

        if ore_rimanenti > 0:
            return False

        # Commit: aggiorna strutture di tracking per ogni frammento
        for a in fragments:
            result.assignments.append(a)
        for (t_eff, ggg, h, a_frag) in commit_queue:
            self._commit_allocation(t_eff, ggg, h, a_frag)
        for ggg, t_eff in tecnici_usati_per_split.items():
            self._mark_impianto(ticket.impianto_id, t_eff.id, ggg)

        tecnici_ids_usati = list({a.tecnico_id for a in fragments})
        if len(tecnici_ids_usati) > 1:
            result.explanation_log.append(
                f"[OK-SPLIT-MULTI] Ticket #{ticket.id} → {len(fragments)} frammenti su tecnici "
                f"{tecnici_ids_usati} ({durata_totale:.1f}h totali)"
            )
        else:
            result.explanation_log.append(
                f"[OK-SPLIT] Ticket #{ticket.id} → Tecnico #{tecnico.id}, "
                f"{len(fragments)} frammenti ({durata_totale:.1f}h totali)"
            )
        return True

    def _make_assignment(
        self,
        ticket: PlannerTicket,
        tecnico: PlannerTecnico,
        giorno: date,
        durata: float,
        is_cont: bool,
        parent_id: Optional[int] = None,
    ) -> Assignment:
        """
        Crea un Assignment calcolando start/end in base alle strutture di tracking.

        - Se slot_minutes è attivo: trova il primo blocco libero nel slot_grid e
          posiziona start/end in base agli slot effettivi (granularità slot_minutes).
        - Altrimenti: usa ore_consumate (float) — comportamento legacy invariato.

        L'end viene clampato all'orario di fine del tecnico per evitare overflow
        visivo sul Gantt (la capacità è già garantita dalle hard rules).
        """
        fine_t = _parse_time(tecnico.orario_fine, fallback=time(17, 0))
        fine_float = fine_t.hour + fine_t.minute / 60.0

        if self.slot_minutes is not None:
            sm = self.slot_minutes
            grid = self.slot_grid.get(tecnico.id, {}).get(giorno, [])
            slots_n = _slots_needed(durata, sm)
            free_start = _find_free_block(grid, slots_n)
            if free_start is None:
                # Fallback: appendi in fondo (non dovrebbe accadere se _ore_libere è corretto)
                free_start = sum(1 for s in grid if s)
            start_float = _slot_to_ore_float(free_start, tecnico.orario_inizio, sm)
            end_float = _slot_to_ore_float(free_start + slots_n, tecnico.orario_inizio, sm)
        else:
            ore_usate = self.ore_consumate[tecnico.id].get(giorno, 0.0)
            start_float = _ore_start_di_giorno(tecnico.orario_inizio) + ore_usate
            end_float = start_float + durata

        if end_float > fine_float:
            end_float = fine_float

        start_dt = _datetime_for(giorno, start_float)
        end_dt = _datetime_for(giorno, end_float)
        return Assignment(
            ticket_id=ticket.id,
            tecnico_id=tecnico.id,
            start=start_dt,
            end=end_dt,
            is_continuation=is_cont,
            parent_ticket_id=parent_id,
        )

    def _mark_impianto(self, impianto_id: Optional[int], tecnico_id: int, giorno: date) -> None:
        if impianto_id:
            self._impianto_cache[(impianto_id, tecnico_id, giorno)] = True

    @staticmethod
    def _pick_reason(reasons: set) -> str:
        """Ritorna il reason code con priorità più alta."""
        for r in REASON_PRIORITY:
            if r in reasons:
                return r
        return REASON_NO_AVAILABILITY
