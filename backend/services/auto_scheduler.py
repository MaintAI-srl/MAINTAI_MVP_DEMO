"""
Auto Scheduler — Motore deterministico di auto-scheduling ticket (saturazione ore).

Obiettivo: assegnare automaticamente i ticket disponibili ai tecnici cercando di
occupare il più possibile le ore lavorative disponibili (giornaliere e settimanali),
SENZA gestione SLA / penali / scadenze contrattuali.

Caratteristiche chiave (vedi `Algoritmo planning.md`):
  - Esclude sempre sabato e domenica.
  - Nessun overbooking: un tecnico non ha mai ticket sovrapposti.
  - Nessuno straordinario nell'MVP: non si supera l'orario di fine giornata né la
    capacità giornaliera/settimanale del tecnico.
  - Logica 100% deterministica e ripetibile (nessuna chiamata AI).

Il modulo lavora SOLO su strutture dati Python (nessuna dipendenza ORM/DB diretta),
per facilitare il testing unitario isolato. L'adattamento ORM ↔ strutture è nel
bridge `auto_scheduler_bridge.py`.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Set, Tuple
import logging

logger = logging.getLogger(__name__)

# ── Reason codes esclusioni ───────────────────────────────────────────────────

NON_SCHEDULABILE_DATI_MANCANTI = "NON_SCHEDULABILE_DATI_MANCANTI"
NON_SCHEDULABILE_SKILL_ASSENTE = "NON_SCHEDULABILE_SKILL_ASSENTE"
NON_SCHEDULABILE_SLOT_ASSENTE  = "NON_SCHEDULABILE_SLOT_ASSENTE"
NON_SCHEDULABILE_MATERIALI     = "NON_SCHEDULABILE_MATERIALI"
NON_SCHEDULABILE_STATO         = "NON_SCHEDULABILE_STATO"

# Stati ticket compatibili con lo scheduling automatico
SCHEDULABLE_STATES = {"aperto", "pianificato"}
# Stati che escludono sempre il ticket (chiuso/annullato)
TERMINAL_STATES = {"chiuso", "eliminato", "annullato", "cancellato"}

# Durata di default (minuti) se mancante e il progetto la prevede
DEFAULT_DURATION_MINUTES = 60

# Saturazione (frazione) oltre la quale un tecnico è considerato "saturo"
SATURATION_THRESHOLD = 0.90


# ── Strutture dati di input ───────────────────────────────────────────────────

@dataclass
class SchedTechnician:
    id: int
    name: str
    skills: List[str]                       # competenze normalizzate (uppercase)
    workday_start: str = "08:00"            # HH:MM
    workday_end: str = "17:00"              # HH:MM
    daily_capacity_minutes: int = 480       # capacità massima giornaliera
    weekly_capacity_minutes: int = 2400     # capacità massima settimanale
    active: bool = True
    base_site_id: Optional[int] = None
    absent_days: List[date] = field(default_factory=list)


@dataclass
class SchedTicket:
    id: int
    title: str = ""
    site_id: Optional[int] = None
    asset_id: Optional[int] = None
    status: str = "Aperto"
    required_skill: Optional[str] = None
    estimated_duration_minutes: Optional[int] = None
    priority: str = "Media"                  # Alta | Media | Bassa
    asset_criticality: Optional[str] = None  # A | B | C (alta | media | bassa)
    materials_ready: bool = True
    materials_required: bool = False
    access_window_start: Optional[str] = None  # HH:MM — None = nessun vincolo
    access_window_end: Optional[str] = None
    age_days: int = 0
    # Giorni alla scadenza (scadenziario): negativo = scaduto, None = nessuna scadenza
    deadline_days: Optional[int] = None
    # Riempito a runtime
    score: float = 0.0


@dataclass
class CalendarBlock:
    technician_id: int
    start: datetime
    end: datetime
    ticket_id: Optional[int] = None
    type: str = "TICKET"      # TICKET | PAUSA | BLOCCO | FERIE | ALTRO
    source: str = "AUTO"      # MANUAL | AUTO
    status: str = "PROPOSED"  # PROPOSED | CONFIRMED
    duration_minutes: int = 0


# ── Helper temporali ──────────────────────────────────────────────────────────

def _hhmm_to_min(value: Optional[str], fallback: int) -> int:
    """Converte 'HH:MM' in minuti dalla mezzanotte. Fallback su valore invalido."""
    if not value:
        return fallback
    try:
        h, m = value.split(":")[:2]
        return int(h) * 60 + int(m)
    except (ValueError, AttributeError, IndexError):
        logger.warning("auto_scheduler: orario invalido '%s', uso fallback", value)
        return fallback


def _min_to_dt(day: date, minutes: int) -> datetime:
    return datetime(day.year, day.month, day.day, minutes // 60, minutes % 60)


def _week_key(d: date) -> Tuple[int, int]:
    """Chiave ISO (anno, settimana) per aggregazione settimanale."""
    iso = d.isocalendar()
    return (iso[0], iso[1])


def is_weekend(d: date) -> bool:
    return d.weekday() >= 5


def get_working_days(start_date: date, end_date: date, include_weekends: bool = False) -> List[date]:
    """Lista dei giorni pianificabili nell'orizzonte (sabato/domenica esclusi)."""
    days: List[date] = []
    d = start_date
    while d <= end_date:
        if include_weekends or not is_weekend(d):
            days.append(d)
        d += timedelta(days=1)
    return days


# ── Schedulabilità e scoring ticket ───────────────────────────────────────────

def _ticket_duration(ticket: SchedTicket, apply_default: bool = False) -> Optional[int]:
    dur = ticket.estimated_duration_minutes
    if (dur is None or dur <= 0) and apply_default:
        return DEFAULT_DURATION_MINUTES
    return dur


def is_ticket_schedulable(ticket: SchedTicket, apply_default_duration: bool = False) -> Tuple[bool, Optional[str]]:
    """
    Verifica i dati minimi richiesti per lo scheduling automatico.

    Ritorna (True, None) se schedulabile, altrimenti (False, reason_code).
    NB: la presenza di un tecnico compatibile / di uno slot NON è verificata qui
    (vengono valutate nel ciclo di assegnazione → SKILL_ASSENTE / SLOT_ASSENTE).
    """
    stato = (ticket.status or "").strip().lower()
    if stato in TERMINAL_STATES:
        return False, NON_SCHEDULABILE_STATO
    if stato and stato not in SCHEDULABLE_STATES:
        return False, NON_SCHEDULABILE_STATO

    dur = _ticket_duration(ticket, apply_default=apply_default_duration)
    if dur is None or dur <= 0:
        return False, NON_SCHEDULABILE_DATI_MANCANTI

    # Serve un ancoraggio di luogo: sito oppure asset
    if ticket.site_id is None and ticket.asset_id is None:
        return False, NON_SCHEDULABILE_DATI_MANCANTI

    # Serve la skill richiesta (il bridge usa il tipo come proxy se mancante)
    if not (ticket.required_skill and ticket.required_skill.strip()):
        return False, NON_SCHEDULABILE_DATI_MANCANTI

    # Materiali: se necessari e non pronti → escluso
    if ticket.materials_required and not ticket.materials_ready:
        return False, NON_SCHEDULABILE_MATERIALI

    return True, None


def _priority_score(priority: str) -> int:
    return {"alta": 40, "media": 20, "bassa": 5}.get((priority or "").strip().lower(), 20)


def _criticality_score(criticality: Optional[str]) -> int:
    if not criticality:
        return 0
    c = criticality.strip().upper()
    return {"A": 30, "ALTA": 30, "B": 15, "MEDIA": 15, "C": 0, "BASSA": 0}.get(c, 0)


def _aging_score(age_days: int) -> int:
    if age_days > 7:
        return 15
    if age_days > 3:
        return 10
    return 0


def _deadline_score(deadline_days: Optional[int]) -> int:
    """
    Urgenza da scadenziario: i ticket scaduti o prossimi alla scadenza vengono
    piazzati prima (e quindi nei giorni più vicini alla generazione).
    """
    if deadline_days is None:
        return 0
    if deadline_days <= 0:
        return 60   # scaduto: massima urgenza
    if deadline_days <= 3:
        return 35
    if deadline_days <= 7:
        return 20
    if deadline_days <= 14:
        return 10
    return 0


def calculate_ticket_score(ticket: SchedTicket, rare_skills: Optional[Set[str]] = None) -> float:
    """
    Score di ordinamento ticket (più alto = piazzato prima).

    Componenti (SLA esclusa):
      priorità tecnica + criticità asset + aging + rarità skill + durata utile.
    """
    rare_skills = rare_skills or set()
    score = 0.0
    score += _priority_score(ticket.priority)
    score += _criticality_score(ticket.asset_criticality)
    score += _aging_score(ticket.age_days)
    score += _deadline_score(ticket.deadline_days)

    skill = (ticket.required_skill or "").strip().upper()
    if skill and skill in rare_skills:
        score += 15  # skill rara → piazzala prima (poche risorse disponibili)

    # Durata utile al riempimento: i ticket più lunghi prima, ma con peso contenuto
    dur = _ticket_duration(ticket, apply_default=True) or 0
    score += min(dur / 60.0, 8.0) * 2.0  # max +16

    return round(score, 3)


# ── Skill / slot constraints ──────────────────────────────────────────────────

def has_required_skill(technician: SchedTechnician, ticket: SchedTicket) -> bool:
    """True se il tecnico copre la skill richiesta dal ticket."""
    req = (ticket.required_skill or "").strip().upper()
    if not req:
        return True
    return req in {s.strip().upper() for s in technician.skills}


def slot_can_fit_ticket(slot_start: datetime, slot_end: datetime, duration_minutes: int) -> bool:
    """True se nello slot libero ci sta l'intera durata del ticket."""
    free = (slot_end - slot_start).total_seconds() / 60.0
    return free + 1e-6 >= duration_minutes


def exceeds_working_hours(end_dt: datetime, technician: SchedTechnician) -> bool:
    """True se la fine intervento supera l'orario di fine giornata del tecnico."""
    end_min = end_dt.hour * 60 + end_dt.minute
    return end_min > _hhmm_to_min(technician.workday_end, 17 * 60) + 1e-6


# ── Disponibilità tecnici ─────────────────────────────────────────────────────

class TechnicianAvailability:
    """
    Traccia, per ogni tecnico, gli intervalli occupati, gli slot liberi e la
    saturazione giornaliera/settimanale. Aggiornata incrementalmente con reserve().
    """

    def __init__(
        self,
        technicians: List[SchedTechnician],
        calendar_blocks: List[CalendarBlock],
        working_days: List[date],
    ):
        self.tech_map: Dict[int, SchedTechnician] = {t.id: t for t in technicians}
        self.working_days = working_days
        # busy[tech_id][day] = list[(start_min, end_min)]
        self.busy: Dict[int, Dict[date, List[Tuple[int, int]]]] = defaultdict(lambda: defaultdict(list))
        # minuti già assegnati (per capacità)
        self.daily_assigned: Dict[int, Dict[date, int]] = defaultdict(lambda: defaultdict(int))
        self.weekly_assigned: Dict[Tuple[int, Tuple[int, int]], int] = defaultdict(int)
        # sito già presidiato dal tecnico in giornata (per site grouping)
        self.site_by_tech_day: Dict[Tuple[int, date], Set[int]] = defaultdict(set)

        for b in calendar_blocks:
            self._register(b, count_capacity=True)

    def _register(self, block: CalendarBlock, count_capacity: bool) -> None:
        day = block.start.date()
        s = block.start.hour * 60 + block.start.minute
        e = block.end.hour * 60 + block.end.minute
        self.busy[block.technician_id][day].append((s, e))
        if count_capacity:
            dur = int(round((block.end - block.start).total_seconds() / 60.0))
            self.daily_assigned[block.technician_id][day] += dur
            self.weekly_assigned[(block.technician_id, _week_key(day))] += dur
        if block.ticket_id is not None:
            # Il sito viene aggiunto esplicitamente in reserve(); qui per i blocchi pre-esistenti
            pass

    def free_slots(self, tech_id: int, day: date) -> List[Tuple[datetime, datetime]]:
        """Slot liberi del tecnico nel giorno, dentro la finestra lavorativa."""
        tech = self.tech_map.get(tech_id)
        if tech is None or not tech.active:
            return []
        if day in tech.absent_days:
            return []
        start_min = _hhmm_to_min(tech.workday_start, 8 * 60)
        end_min = _hhmm_to_min(tech.workday_end, 17 * 60)
        if end_min <= start_min:
            return []

        busy = sorted(self.busy[tech_id].get(day, []))
        slots: List[Tuple[int, int]] = []
        cursor = start_min
        for bs, be in busy:
            bs = max(bs, start_min)
            be = min(be, end_min)
            if be <= bs:
                continue
            if bs > cursor:
                slots.append((cursor, bs))
            cursor = max(cursor, be)
        if cursor < end_min:
            slots.append((cursor, end_min))

        return [(_min_to_dt(day, s), _min_to_dt(day, e)) for s, e in slots]

    def daily_saturation(self, tech_id: int, day: date) -> float:
        tech = self.tech_map.get(tech_id)
        cap = tech.daily_capacity_minutes if tech else 480
        if cap <= 0:
            return 1.0
        return self.daily_assigned[tech_id].get(day, 0) / cap

    def weekly_saturation(self, tech_id: int, day: date) -> float:
        tech = self.tech_map.get(tech_id)
        cap = tech.weekly_capacity_minutes if tech else 2400
        if cap <= 0:
            return 1.0
        return self.weekly_assigned.get((tech_id, _week_key(day)), 0) / cap

    def has_daily_capacity(self, tech_id: int, day: date, minutes: int) -> bool:
        tech = self.tech_map.get(tech_id)
        cap = tech.daily_capacity_minutes if tech else 480
        return self.daily_assigned[tech_id].get(day, 0) + minutes <= cap + 1e-6

    def has_weekly_capacity(self, tech_id: int, day: date, minutes: int) -> bool:
        tech = self.tech_map.get(tech_id)
        cap = tech.weekly_capacity_minutes if tech else 2400
        return self.weekly_assigned.get((tech_id, _week_key(day)), 0) + minutes <= cap + 1e-6

    def site_active_today(self, tech_id: int, day: date, site_id: Optional[int]) -> bool:
        if site_id is None:
            return False
        return site_id in self.site_by_tech_day.get((tech_id, day), set())

    def reserve(self, tech_id: int, start: datetime, end: datetime, site_id: Optional[int]) -> None:
        day = start.date()
        s = start.hour * 60 + start.minute
        e = end.hour * 60 + end.minute
        self.busy[tech_id][day].append((s, e))
        dur = int(round((end - start).total_seconds() / 60.0))
        self.daily_assigned[tech_id][day] += dur
        self.weekly_assigned[(tech_id, _week_key(day))] += dur
        if site_id is not None:
            self.site_by_tech_day[(tech_id, day)].add(site_id)


def build_technician_availability(
    technicians: List[SchedTechnician],
    calendar_blocks: List[CalendarBlock],
    working_days: List[date],
) -> TechnicianAvailability:
    return TechnicianAvailability(technicians, calendar_blocks, working_days)


# ── Slot scoring ──────────────────────────────────────────────────────────────

def calculate_slot_score(
    ticket: SchedTicket,
    technician: SchedTechnician,
    slot_start: datetime,
    slot_end: datetime,
    duration_minutes: int,
    availability: TechnicianAvailability,
    day_index: int = 0,
    horizon_len: int = 1,
) -> float:
    """
    Punteggio di una possibile assegnazione (più alto = migliore).

    SlotScore = skill_match + fill_score + daily_balance + weekly_balance
                + site_grouping + earliness - fragmentation_penalty
    (l'overtime è un hard-constraint: gestito prima dello scoring).

    Bilanciamento del carico CONTINUO: il tecnico meno saturo è sempre preferito,
    così i ticket si distribuiscono su tutti i tecnici invece di concentrarsi sul
    primo. Questo evita il caso "tutti i ticket a un solo tecnico".
    """
    day = slot_start.date()
    score = 0.0

    # skill_match: skill esatta (job-skill) = +30, generica (PM/CM/BD) = +15
    req = (ticket.required_skill or "").strip().upper()
    generic = {"PM", "CM", "BD", "ISP"}
    score += 15 if req in generic else 30

    # residuo nello slot dopo aver piazzato il ticket all'inizio dello slot
    slot_minutes = (slot_end - slot_start).total_seconds() / 60.0
    residuo = slot_minutes - duration_minutes

    # fill_score: premia gli slot riempiti bene
    if residuo <= 1e-6:
        score += 30
    elif residuo <= 30:
        score += 20
    elif residuo <= 60:
        score += 10

    # weekly_balance (continuo): tecnico meno saturo nella settimana → preferito
    wsat = availability.weekly_saturation(technician.id, day)
    score += max(0.0, 1.0 - wsat) * 25.0

    # daily_balance (continuo): tecnico meno saturo nella giornata → preferito
    dsat = availability.daily_saturation(technician.id, day)
    score += max(0.0, 1.0 - dsat) * 15.0

    # site_grouping: stesso sito di un altro ticket nello stesso giorno
    if availability.site_active_today(technician.id, day, ticket.site_id):
        score += 20
    elif technician.base_site_id is not None and technician.base_site_id == ticket.site_id:
        score += 10

    # earliness: preferisci i giorni più vicini alla generazione (tie-breaker)
    if horizon_len > 0:
        score += (horizon_len - day_index) / horizon_len * 8.0

    # fragmentation_penalty: penalizza i buchi residui inutilizzabili
    if residuo > 120:
        score -= 10
    elif residuo > 60:
        score -= 5

    return round(score, 3)


# ── Assegnazione e spiegazione ────────────────────────────────────────────────

@dataclass
class _Candidate:
    ticket: SchedTicket
    technician: SchedTechnician
    start: datetime
    end: datetime
    slot_start: datetime
    slot_end: datetime
    score: float


def create_assignment(candidate: _Candidate) -> CalendarBlock:
    dur = int(round((candidate.end - candidate.start).total_seconds() / 60.0))
    return CalendarBlock(
        technician_id=candidate.technician.id,
        ticket_id=candidate.ticket.id,
        start=candidate.start,
        end=candidate.end,
        duration_minutes=dur,
        type="TICKET",
        source="AUTO",
        status="PROPOSED",
    )


def explain_assignment(candidate: _Candidate, availability: "TechnicianAvailability") -> str:
    """Spiegazione leggibile (italiano) del perché di un'assegnazione."""
    t = candidate.ticket
    tech = candidate.technician
    day = candidate.start.date()
    motivi: List[str] = []
    skill = (t.required_skill or "").strip().upper()
    motivi.append(f"tecnico con skill {skill or 'generica'} compatibile")
    motivi.append("slot libero sufficiente, nessuna sovrapposizione")

    residuo = (candidate.slot_end - candidate.slot_start).total_seconds() / 60.0 - (
        (candidate.end - candidate.start).total_seconds() / 60.0
    )
    if residuo <= 30:
        motivi.append("riempie bene lo slot (pochi minuti residui)")
    wsat = availability.weekly_saturation(tech.id, day)
    if wsat < 0.80:
        motivi.append(f"{tech.name} aveva saturazione settimanale contenuta ({round(wsat * 100)}%)")
    if availability.site_active_today(tech.id, day, t.site_id):
        motivi.append("accorpato ad altri interventi dello stesso sito in giornata")
    motivi.append("giorno lavorativo (no weekend)")

    return (
        f"Ticket #{t.id} assegnato a {tech.name} il {day.strftime('%d/%m/%Y')} "
        f"dalle {candidate.start.strftime('%H:%M')} alle {candidate.end.strftime('%H:%M')}. "
        f"Motivi: " + "; ".join(motivi) + "."
    )


# ── Riepilogo / KPI ───────────────────────────────────────────────────────────

def calculate_schedule_summary(
    technicians: List[SchedTechnician],
    calendar_blocks: List[CalendarBlock],
    working_days: List[date],
    total_analyzed: int,
    total_scheduled: int,
    total_excluded: int,
) -> Dict:
    """KPI di saturazione (giornaliera, settimanale, periodo) e per tecnico."""
    working_set = set(working_days)
    active_techs = [t for t in technicians if t.active]

    # Minuti occupati per (tech, day) — considera tutti i blocchi TICKET nell'orizzonte
    busy_by_tech_day: Dict[Tuple[int, date], int] = defaultdict(int)
    for b in calendar_blocks:
        day = b.start.date()
        if day not in working_set:
            continue
        busy_by_tech_day[(b.technician_id, day)] += int(round((b.end - b.start).total_seconds() / 60.0))

    # Capacità per (tech, day)
    def cap_for(tech: SchedTechnician, day: date) -> int:
        if day in tech.absent_days:
            return 0
        return tech.daily_capacity_minutes

    # Aggregati per giorno
    day_caps: Dict[date, int] = defaultdict(int)
    day_sched: Dict[date, int] = defaultdict(int)
    for tech in active_techs:
        for day in working_days:
            day_caps[day] += cap_for(tech, day)
            day_sched[day] += busy_by_tech_day.get((tech.id, day), 0)

    # Saturazione giornaliera media (sui giorni con capacità > 0)
    daily_ratios = [day_sched[d] / day_caps[d] for d in working_days if day_caps[d] > 0]
    daily_sat = round(sum(daily_ratios) / len(daily_ratios) * 100, 1) if daily_ratios else 0.0
    avg_daily_cap = round(sum(day_caps.values()) / len(working_days)) if working_days else 0
    avg_daily_sched = round(sum(day_sched.values()) / len(working_days)) if working_days else 0

    # Aggregati per settimana ISO
    week_caps: Dict[Tuple[int, int], int] = defaultdict(int)
    week_sched: Dict[Tuple[int, int], int] = defaultdict(int)
    for day in working_days:
        wk = _week_key(day)
        week_caps[wk] += day_caps[day]
        week_sched[wk] += day_sched[day]
    weekly_ratios = [week_sched[w] / week_caps[w] for w in week_caps if week_caps[w] > 0]
    weekly_sat = round(sum(weekly_ratios) / len(weekly_ratios) * 100, 1) if weekly_ratios else 0.0
    n_weeks = max(1, len(week_caps))
    weekly_cap = round(sum(week_caps.values()) / n_weeks)
    weekly_sched = round(sum(week_sched.values()) / n_weeks)

    # Totali periodo
    total_cap = sum(day_caps.values())
    total_sched = sum(day_sched.values())
    period_util = round(total_sched / total_cap * 100, 1) if total_cap > 0 else 0.0

    # Per tecnico (sull'intero orizzonte)
    tech_rows = []
    n_saturated = 0
    n_undersaturated = 0
    for tech in active_techs:
        cap = sum(cap_for(tech, d) for d in working_days)
        sched = sum(busy_by_tech_day.get((tech.id, d), 0) for d in working_days)
        util = round(sched / cap * 100, 1) if cap > 0 else 0.0
        saturo = cap > 0 and (sched / cap) >= SATURATION_THRESHOLD
        if saturo:
            n_saturated += 1
        else:
            n_undersaturated += 1
        tech_rows.append({
            "technician_id": tech.id,
            "name": tech.name,
            "capacity_minutes": cap,
            "scheduled_minutes": sched,
            "utilization_percent": util,
            "saturo": saturo,
        })

    return {
        "total_tickets_analyzed": total_analyzed,
        "tickets_scheduled": total_scheduled,
        "tickets_excluded": total_excluded,
        "horizon_working_days": len(working_days),
        # Periodo
        "capacity_minutes": total_cap,
        "scheduled_minutes": total_sched,
        "utilization_percent": period_util,
        # Giornaliera (media)
        "daily_capacity_minutes": avg_daily_cap,
        "daily_scheduled_minutes": avg_daily_sched,
        "daily_utilization_percent": daily_sat,
        # Settimanale (media)
        "weekly_capacity_minutes": weekly_cap,
        "weekly_scheduled_minutes": weekly_sched,
        "weekly_utilization_percent": weekly_sat,
        # Tecnici
        "technicians": tech_rows,
        "technicians_saturated": n_saturated,
        "technicians_undersaturated": n_undersaturated,
    }


# ── Funzione principale ───────────────────────────────────────────────────────

def auto_schedule_tickets(
    tickets: List[SchedTicket],
    technicians: List[SchedTechnician],
    calendar_blocks: List[CalendarBlock],
    start_date: date,
    end_date: date,
    include_weekends: bool = False,
    mode: str = "weekly_fill",
    apply_default_duration: bool = True,
) -> Dict:
    """
    Auto-scheduling deterministico dei ticket con obiettivo di saturazione ore.

    Ritorna un dizionario con:
      - assignments: lista assegnazioni (con motivazione)
      - excluded:    lista ticket non schedulabili (con reason_code)
      - summary:     KPI di saturazione giornaliera/settimanale/periodo
      - calendar_blocks: blocchi calendario creati (status PROPOSED)
    """
    result: Dict = {"assignments": [], "excluded": [], "summary": {}, "calendar_blocks": []}

    # Copia difensiva dei blocchi esistenti (non mutiamo l'input del chiamante)
    existing_blocks = list(calendar_blocks)

    # ── 1. Filtra ticket schedulabili + calcola rarità skill ──────────────────
    active_techs = [t for t in technicians if t.active]
    skill_supply: Dict[str, int] = defaultdict(int)
    for tech in active_techs:
        for s in {s.strip().upper() for s in tech.skills}:
            skill_supply[s] += 1
    rare_skills = {s for s, cnt in skill_supply.items() if cnt <= 1}

    schedulable: List[SchedTicket] = []
    for ticket in tickets:
        valid, reason = is_ticket_schedulable(ticket, apply_default_duration=apply_default_duration)
        if not valid:
            result["excluded"].append({"ticket_id": ticket.id, "reason": reason})
            continue
        ticket.score = calculate_ticket_score(ticket, rare_skills=rare_skills)
        schedulable.append(ticket)

    # ── 2. Ordina i ticket (score desc, poi aging, durata, id per determinismo)─
    schedulable.sort(
        key=lambda t: (
            -t.score,
            -t.age_days,
            -(_ticket_duration(t, apply_default=True) or 0),
            t.id,
        )
    )

    # ── 3. Genera orizzonte e disponibilità ───────────────────────────────────
    working_days = get_working_days(start_date, end_date, include_weekends=include_weekends)
    availability = build_technician_availability(active_techs, existing_blocks, working_days)

    if not working_days or not active_techs:
        for ticket in schedulable:
            result["excluded"].append({"ticket_id": ticket.id, "reason": NON_SCHEDULABILE_SLOT_ASSENTE})
        result["summary"] = calculate_schedule_summary(
            technicians, existing_blocks, working_days,
            total_analyzed=len(tickets),
            total_scheduled=0,
            total_excluded=len(result["excluded"]),
        )
        return result

    # ── 4. Assegnazione greedy ────────────────────────────────────────────────
    for ticket in schedulable:
        duration = _ticket_duration(ticket, apply_default=apply_default_duration) or DEFAULT_DURATION_MINUTES
        best: Optional[_Candidate] = None
        skill_found = False

        horizon_len = len(working_days)
        for tech in active_techs:
            if not has_required_skill(tech, ticket):
                continue
            skill_found = True

            for day_index, day in enumerate(working_days):
                if is_weekend(day):
                    continue  # hard-constraint ridondante ma esplicito
                if not availability.has_daily_capacity(tech.id, day, duration):
                    continue
                if not availability.has_weekly_capacity(tech.id, day, duration):
                    continue

                for slot_start, slot_end in availability.free_slots(tech.id, day):
                    # Vincolo finestra di accesso (se presente)
                    eff_start, eff_end = _apply_access_window(slot_start, slot_end, ticket)
                    if eff_start is None:
                        continue
                    if not slot_can_fit_ticket(eff_start, eff_end, duration):
                        continue
                    start_dt = eff_start
                    end_dt = start_dt + timedelta(minutes=duration)
                    if exceeds_working_hours(end_dt, tech):
                        continue

                    score = calculate_slot_score(
                        ticket, tech, slot_start, slot_end, duration, availability,
                        day_index=day_index, horizon_len=horizon_len,
                    )
                    if best is None or score > best.score:
                        best = _Candidate(
                            ticket=ticket, technician=tech,
                            start=start_dt, end=end_dt,
                            slot_start=slot_start, slot_end=slot_end,
                            score=score,
                        )

        if best is not None:
            block = create_assignment(best)
            availability.reserve(best.technician.id, best.start, best.end, ticket.site_id)
            existing_blocks.append(block)
            result["calendar_blocks"].append(block)
            result["assignments"].append({
                "ticket_id": ticket.id,
                "technician_id": best.technician.id,
                "start": best.start.isoformat(),
                "end": best.end.isoformat(),
                "duration_minutes": int(round((best.end - best.start).total_seconds() / 60.0)),
                "score": best.score,
                "reason": explain_assignment(best, availability),
            })
        else:
            reason = NON_SCHEDULABILE_SKILL_ASSENTE if not skill_found else NON_SCHEDULABILE_SLOT_ASSENTE
            result["excluded"].append({"ticket_id": ticket.id, "reason": reason})

    # ── 5. Riepilogo ──────────────────────────────────────────────────────────
    result["summary"] = calculate_schedule_summary(
        technicians, existing_blocks, working_days,
        total_analyzed=len(tickets),
        total_scheduled=len(result["assignments"]),
        total_excluded=len(result["excluded"]),
    )
    return result


def _apply_access_window(
    slot_start: datetime,
    slot_end: datetime,
    ticket: SchedTicket,
) -> Tuple[Optional[datetime], Optional[datetime]]:
    """Interseca lo slot libero con la finestra di accesso del ticket (se presente)."""
    if not ticket.access_window_start and not ticket.access_window_end:
        return slot_start, slot_end
    day = slot_start.date()
    aw_start = _hhmm_to_min(ticket.access_window_start, 0) if ticket.access_window_start else 0
    aw_end = _hhmm_to_min(ticket.access_window_end, 24 * 60) if ticket.access_window_end else 24 * 60
    win_start = _min_to_dt(day, aw_start)
    win_end = _min_to_dt(day, min(aw_end, 24 * 60 - 1))
    eff_start = max(slot_start, win_start)
    eff_end = min(slot_end, win_end)
    if eff_end <= eff_start:
        return None, None
    return eff_start, eff_end
