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


def _competenza_richiesta(ticket: PlannerTicket) -> str:
    """Ritorna la competenza richiesta: usa il campo se presente, altrimenti tipo."""
    if ticket.competenza_richiesta:
        return ticket.competenza_richiesta.strip().upper()
    return ticket.tipo.strip().upper()


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

class PlannerEngine:
    """
    Motore deterministico di scheduling.
    Utilizza greedy scheduling con scoring soft-rules.
    """

    def __init__(
        self,
        tecnici: List[PlannerTecnico],
        tickets: List[PlannerTicket],
        existing_assignments: List[PlannerAssignment],
        today: date,
        horizon_days: int = 7,
    ):
        self.tecnici = tecnici
        self.tickets = tickets
        self.existing_assignments = existing_assignments
        self.today = today
        self.horizon_days = horizon_days

        # Orizzonte di pianificazione
        self.horizon: List[date] = [today + timedelta(days=i) for i in range(horizon_days)]

        # ore_consumate[tecnico_id][giorno] = float
        self.ore_consumate: Dict[int, Dict[date, float]] = {
            t.id: {d: 0.0 for d in self.horizon}
            for t in tecnici
        }

        # Tecnici attivi
        self.tecnici_attivi = [t for t in tecnici if t.stato.lower() in ("in_servizio", "in servizio")]

        # Pre-popola assenze: i giorni di assenza vengono resi indisponibili
        # saturando le ore_consumate a ore_giornaliere per quel giorno.
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
                if a.tecnico_id in self.ore_consumate and giorno in self.ore_consumate[a.tecnico_id]:
                    durata = (a.end - a.start).total_seconds() / 3600.0
                    self.ore_consumate[a.tecnico_id][giorno] += durata
                    result.explanation_log.append(
                        f"[LOCKED] Ticket #{a.ticket_id} → Tecnico #{a.tecnico_id} il {giorno} ({durata:.1f}h)"
                    )

        # ── FASE 1: Ordina ticket per urgenza ────────────────────────────────
        to_schedule = [t for t in self.tickets if t.id not in locked_ticket_ids]
        to_schedule.sort(key=lambda t: (
            -_priorita_score(t.priorita),
            _sla_key(t),
            -_tipo_score(t.tipo),
        ))

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
                # HARD: skill check
                comp = _competenza_richiesta(ticket)
                tec_comp = [c.strip().upper() for c in tecnico.competenze]
                if comp not in tec_comp:
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
                ore_libere = tecnico.ore_giornaliere - self.ore_consumate[tecnico.id].get(giorno, 0.0)
                if ore_libere <= 0:
                    failure_reasons.add(REASON_CAPACITY_EXCEEDED)
                    continue

                candidati.append((tecnico, giorno, ore_libere))

        # Se nessun giorno era dentro la finestra temporale, è un TIME_WINDOW_CONFLICT
        if days_in_window == 0:
            failure_reasons.add(REASON_TIME_WINDOW_CONFLICT)


        if not candidati:
            reason = self._pick_reason(failure_reasons)
            result.unassigned.append(Unassigned(
                ticket_id=ticket.id,
                reason_code=reason,
                detail=f"Nessun tecnico/giorno valido trovato (motivi: {failure_reasons})",
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
        """
        durata_totale = ticket.durata_stimata_ore
        ore_libere_d0 = tecnico.ore_giornaliere - self.ore_consumate[tecnico.id].get(giorno_start, 0.0)

        # Caso semplice: entra tutto nel primo giorno
        if durata_totale <= ore_libere_d0:
            a = self._make_assignment(ticket, tecnico, giorno_start, durata_totale, is_cont=False)
            result.assignments.append(a)
            self.ore_consumate[tecnico.id][giorno_start] += durata_totale
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
                ore_libere = tecnico.ore_giornaliere - self.ore_consumate[tecnico.id].get(giorno, 0.0)
                if ore_libere >= durata_totale:
                    a = self._make_assignment(ticket, tecnico, giorno, durata_totale, is_cont=False)
                    result.assignments.append(a)
                    self.ore_consumate[tecnico.id][giorno] += durata_totale
                    self._mark_impianto(ticket.impianto_id, tecnico.id, giorno)
                    result.explanation_log.append(
                        f"[OK-NOSP] Ticket #{ticket.id} → Tecnico #{tecnico.id} il {giorno} "
                        f"({durata_totale:.1f}h complessive)"
                    )
                    return True
            return False  # nessun giorno con abbastanza ore libere

        # Ticket splittabile: frammenta su più giorni contigui
        ore_rimanenti = durata_totale
        primo = True
        fragments: List[Assignment] = []
        ore_delta: Dict[Tuple, float] = {}  # (tecnico_id, giorno) → ore da aggiungere

        for giorno in self.horizon:
            if giorno < giorno_start:
                continue
            if ore_rimanenti <= 0:
                break
            ore_libere = tecnico.ore_giornaliere - self.ore_consumate[tecnico.id].get(giorno, 0.0)
            if ore_libere <= 0:
                continue
            da_allocare = min(ore_rimanenti, ore_libere)
            a = self._make_assignment(
                ticket, tecnico, giorno, da_allocare,
                is_cont=not primo,
                parent_id=ticket.id if not primo else None,
            )
            fragments.append(a)
            ore_delta[(tecnico.id, giorno)] = ore_delta.get((tecnico.id, giorno), 0.0) + da_allocare
            ore_rimanenti -= da_allocare
            primo = False

        if ore_rimanenti > 0:
            # Non è stato possibile allocare tutto nell'orizzonte con questo tecnico
            return False

        # Commit
        for a in fragments:
            result.assignments.append(a)
        for (tid, ggg), h in ore_delta.items():
            self.ore_consumate[tid][ggg] += h
            self._mark_impianto(ticket.impianto_id, tecnico.id, ggg)

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
        Crea un Assignment calcolando start/end in base alle ore già consumate.
        L'end viene clampato all'orario di fine del tecnico per evitare overflow
        visivo sul Gantt (la capacità è già garantita dalle hard rules).
        """
        ore_usate = self.ore_consumate[tecnico.id].get(giorno, 0.0)
        start_float = _ore_start_di_giorno(tecnico.orario_inizio) + ore_usate
        end_float = start_float + durata

        # Clamp end all'orario di fine del tecnico (es. 17:00 = 17.0)
        fine_t = _parse_time(tecnico.orario_fine, fallback=time(17, 0))
        fine_float = fine_t.hour + fine_t.minute / 60.0
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
