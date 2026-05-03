"""
Test unitari per PlannerEngine.
Eseguibili con:  python -m pytest backend/tests/test_planner_engine.py -v
"""
from __future__ import annotations

import pytest
from datetime import date, datetime, timedelta

from backend.services.planner_engine import (
    PlannerEngine,
    PlannerTecnico,
    PlannerTicket,
    PlannerAssignment,
    REASON_NO_SKILL,
    REASON_CAPACITY_EXCEEDED,
    REASON_LIMITATION_MISMATCH,
    REASON_TIME_WINDOW_CONFLICT,
)

TODAY = date(2026, 4, 7)   # lunedì fisso per test riproducibili


# ── Fixture helpers ───────────────────────────────────────────────────────────

def make_tecnico(
    id: int = 1,
    competenze=None,
    ore_giornaliere: int = 8,
    stato: str = "in_servizio",
    limitazioni=None,
    orario_inizio: str = "08:00",
    area: str | None = None,
    giorni_assenza: list | None = None,
) -> PlannerTecnico:
    return PlannerTecnico(
        id=id,
        nome=f"Tecnico_{id}",
        stato=stato,
        competenze=competenze or ["PM"],
        ore_giornaliere=ore_giornaliere,
        orario_inizio=orario_inizio,
        orario_fine="17:00",
        limitazioni=limitazioni or [],
        area=area,
        giorni_assenza=giorni_assenza or [],
    )


def make_ticket(
    id: int = 101,
    tipo: str = "PM",
    durata: float = 2.0,
    priorita: str = "Media",
    competenza: str | None = None,
    finestra_inizio: date | None = None,
    finestra_fine: date | None = None,
    splittabile: bool = True,
    limitazioni=None,
    impianto_id: int | None = None,
    area: str | None = None,
    scadenza_sla: date | None = None,
) -> PlannerTicket:
    return PlannerTicket(
        id=id,
        impianto_id=impianto_id,
        priorita=priorita,
        tipo=tipo,
        durata_stimata_ore=durata,
        competenza_richiesta=competenza,
        finestra_inizio=finestra_inizio,
        finestra_fine=finestra_fine,
        splittabile=splittabile,
        limitazioni=limitazioni or [],
        area=area,
        scadenza_sla=scadenza_sla,
    )


def run(tecnici, tickets, assignments=None, horizon=7):
    engine = PlannerEngine(
        tecnici=tecnici,
        tickets=tickets,
        existing_assignments=assignments or [],
        today=TODAY,
        horizon_days=horizon,
    )
    return engine.run()


# ── TC-01: Happy Path ─────────────────────────────────────────────────────────

def test_TC01_happy_path():
    """
    1 ticket PM 2h, 1 tecnico qualificato disponibile → deve essere pianificato.
    """
    tecnici = [make_tecnico(id=1, competenze=["PM"], ore_giornaliere=8)]
    tickets = [make_ticket(id=101, tipo="PM", durata=2.0)]

    result = run(tecnici, tickets)

    assert len(result.assignments) == 1, "Deve esserci 1 assegnazione"
    assert len(result.unassigned) == 0, "Nessun ticket non pianificato"
    a = result.assignments[0]
    assert a.ticket_id == 101
    assert a.tecnico_id == 1
    assert a.is_continuation is False
    # Start alle 08:00 (nessun lavoro precedente)
    assert a.start.hour == 8
    assert a.start.minute == 0
    # End a 10:00 (08:00 + 2h)
    assert a.end.hour == 10
    assert a.end.minute == 0
    assert a.start.date() == TODAY


# ── TC-02: NO_SKILL ───────────────────────────────────────────────────────────

def test_TC02_no_skill():
    """
    Ticket BD, tecnico ha solo skill PM → deve finire in unassigned con NO_SKILL.
    """
    tecnici = [make_tecnico(id=1, competenze=["PM"])]
    tickets = [make_ticket(id=102, tipo="BD", durata=3.0, competenza="BD")]

    result = run(tecnici, tickets)

    assert len(result.assignments) == 0
    assert len(result.unassigned) == 1
    u = result.unassigned[0]
    assert u.ticket_id == 102
    assert u.reason_code == REASON_NO_SKILL


# ── TC-03: Split automatico ───────────────────────────────────────────────────

def test_TC03_split_automatico():
    """
    Ticket da 10h, tecnico con 8h/giorno. Splittabile=True.
    → 2 frammenti: 8h giorno 1 + 2h giorno 2.
    """
    tecnici = [make_tecnico(id=1, competenze=["CM"], ore_giornaliere=8)]
    tickets = [make_ticket(id=103, tipo="CM", durata=10.0, splittabile=True)]

    result = run(tecnici, tickets, horizon=7)

    assert len(result.unassigned) == 0, "Non deve essere in unassigned"
    # Deve esserci almeno 2 frammenti
    ticket_frags = [a for a in result.assignments if a.ticket_id == 103]
    assert len(ticket_frags) == 2, f"Devono esserci 2 frammenti, trovati {len(ticket_frags)}"

    # Primo frammento: 8h nel giorno TODAY
    frag1 = ticket_frags[0]
    assert frag1.is_continuation is False
    assert frag1.start.date() == TODAY
    durata1 = (frag1.end - frag1.start).total_seconds() / 3600
    assert abs(durata1 - 8.0) < 0.01, f"Frammento 1 deve essere 8h, trovato {durata1}h"

    # Secondo frammento: 2h nel giorno TODAY+1
    frag2 = ticket_frags[1]
    assert frag2.is_continuation is True
    assert frag2.start.date() == TODAY + timedelta(days=1)
    durata2 = (frag2.end - frag2.start).total_seconds() / 3600
    assert abs(durata2 - 2.0) < 0.01, f"Frammento 2 deve essere 2h, trovato {durata2}h"

    # Durata totale = 10h
    assert abs(durata1 + durata2 - 10.0) < 0.01


# ── TC-04: CAPACITY_EXCEEDED ──────────────────────────────────────────────────

def test_TC04_capacity_exceeded():
    """
    Tecnico pieno (8h locked) e finestra ticket = solo oggi.
    → CAPACITY_EXCEEDED.
    """
    tecnici = [make_tecnico(id=1, competenze=["PM"], ore_giornaliere=8)]
    tickets = [make_ticket(
        id=104,
        tipo="PM",
        durata=2.0,
        finestra_inizio=TODAY,
        finestra_fine=TODAY,   # solo oggi
    )]
    # Assegnazione locked che consuma tutte le 8h
    locked = PlannerAssignment(
        ticket_id=99,
        tecnico_id=1,
        start=datetime(TODAY.year, TODAY.month, TODAY.day, 8, 0),
        end=datetime(TODAY.year, TODAY.month, TODAY.day, 16, 0),
        locked=True,
    )

    result = run(tecnici, tickets, assignments=[locked])

    assert len(result.assignments) == 0
    assert len(result.unassigned) == 1
    u = result.unassigned[0]
    assert u.ticket_id == 104
    assert u.reason_code == REASON_CAPACITY_EXCEEDED


# ── TC-05: Soft Rule — preferire tecnico stesso impianto ──────────────────────

def test_TC05_soft_rule_stesso_impianto():
    """
    2 tecnici qualificati. Il tecnico #2 ha già un ticket sull'impianto 42 oggi.
    Il planner deve preferire il tecnico #2 per il nuovo ticket sullo stesso impianto.
    """
    tecnico1 = make_tecnico(id=1, competenze=["PM"], ore_giornaliere=8)
    tecnico2 = make_tecnico(id=2, competenze=["PM"], ore_giornaliere=8)

    nuovo_ticket = make_ticket(id=105, tipo="PM", durata=2.0, impianto_id=42)

    # Assegnazione esistente NON locked per il tecnico 2 sull'impianto 42
    # (simulata tramite run precedente oppure lock=False)
    # Usiamo un locked=False — non incrementa ore_consumate pre-run,
    # quindi dobbiamo simulare via un primo ticket assegnato a tecnico2

    # Strategia: ticket 50 (stesso impianto) → eseguito prima di 105
    ticket_50 = make_ticket(id=50, tipo="PM", durata=2.0, impianto_id=42)
    tickets = [ticket_50, nuovo_ticket]

    # Forziamo ticket_50 assegnato a tecnico2 mettendolo per primo e vedendo
    # se il soft-rule poi preferisce tecnico2 per ticket 105
    engine = PlannerEngine(
        tecnici=[tecnico1, tecnico2],
        tickets=tickets,
        existing_assignments=[],
        today=TODAY,
        horizon_days=7,
    )
    result = engine.run()

    # Entrambi i ticket devono essere pianificati
    assert len(result.unassigned) == 0, f"Non ci devono essere unassigned: {result.unassigned}"
    assert len(result.assignments) == 2

    # Il ticket 105 deve essere assegnato allo stesso tecnico del ticket 50
    a50 = next(a for a in result.assignments if a.ticket_id == 50)
    a105 = next(a for a in result.assignments if a.ticket_id == 105)

    # Soft rule: tecnico 50 = tecnico 105 (stesso impianto, soft preference)
    # NOTA: il test verifica che la logica di scoring funzioni e produca una scelta stabile
    # Non garantiamo il tecnico specifico (1 o 2), ma verifichiamo che entrambi siano assegnati
    assert a50.tecnico_id == a105.tecnico_id, (
        f"Soft rule violata: ticket 50 → tecnico {a50.tecnico_id}, "
        f"ticket 105 → tecnico {a105.tecnico_id} (dovrebbero essere lo stesso)"
    )


# ── TC-06 (bonus): Tecnico fuori servizio ignorato ────────────────────────────

def test_TC06_tecnico_fuori_servizio():
    """
    Tecnico con stato non 'in_servizio' non deve essere considerato.
    """
    tecnico_off = make_tecnico(id=1, competenze=["PM"], stato="ferie")
    tecnici = [tecnico_off]
    tickets = [make_ticket(id=106, tipo="PM", durata=2.0)]

    result = run(tecnici, tickets)

    assert len(result.assignments) == 0
    assert len(result.unassigned) == 1
    # Quando nessun tecnico attivo, reason sarà NO_AVAILABILITY (set vuoto → default)
    assert result.unassigned[0].ticket_id == 106


# ── TC-07 (bonus): Limitazione mismatch ──────────────────────────────────────

def test_TC07_limitation_mismatch():
    """
    Ticket richiede 'notturno', tecnico ha limitazione 'no_notturno'.
    → LIMITATION_MISMATCH.
    """
    tecnico = make_tecnico(id=1, competenze=["PM"], limitazioni=["no_notturno"])
    ticket = make_ticket(id=107, tipo="PM", durata=2.0, limitazioni=["notturno"])

    result = run([tecnico], [ticket])

    assert len(result.assignments) == 0
    assert len(result.unassigned) == 1
    assert result.unassigned[0].reason_code == REASON_LIMITATION_MISMATCH


# ── TC-08 (bonus): TIME_WINDOW_CONFLICT ──────────────────────────────────────

def test_TC08_time_window_conflict():
    """
    Ticket con finestra domani-dopodomani ma orizzonte = solo oggi.
    → TIME_WINDOW_CONFLICT.
    """
    tecnico = make_tecnico(id=1, competenze=["PM"])
    finestra_start = TODAY + timedelta(days=2)   # dopo l'orizzonte di 1 giorno
    ticket = make_ticket(
        id=108,
        tipo="PM",
        durata=2.0,
        finestra_inizio=finestra_start,
        finestra_fine=finestra_start + timedelta(days=1),
    )

    result = run([tecnico], [ticket], horizon=1)   # orizzonte ristretto: solo TODAY

    assert len(result.assignments) == 0
    assert len(result.unassigned) == 1
    assert result.unassigned[0].reason_code == REASON_TIME_WINDOW_CONFLICT


# ── TC-09: Assenza tecnico rende il giorno non disponibile ────────────────────

def test_TC09_assenza_tecnico():
    """
    Tecnico in assenza per tutti i giorni dell'orizzonte tranne l'ultimo.
    Il ticket deve essere pianificato sull'unico giorno disponibile.
    """
    # 3 giorni di orizzonte: TODAY, TODAY+1, TODAY+2
    # Tecnico assente TODAY e TODAY+1 → disponibile solo TODAY+2
    giorni_assenza = [TODAY, TODAY + timedelta(days=1)]
    tecnico = make_tecnico(id=1, competenze=["PM"], ore_giornaliere=8, giorni_assenza=giorni_assenza)
    ticket = make_ticket(id=109, tipo="PM", durata=2.0)

    result = run([tecnico], [ticket], horizon=3)

    assert len(result.unassigned) == 0, "Il ticket deve essere pianificato sul giorno disponibile"
    assert len(result.assignments) == 1
    a = result.assignments[0]
    assert a.ticket_id == 109
    assert a.tecnico_id == 1
    # Deve essere pianificato su TODAY+2 (unico giorno non in assenza)
    assert a.start.date() == TODAY + timedelta(days=2), (
        f"Atteso {TODAY + timedelta(days=2)}, ottenuto {a.start.date()}"
    )


def test_TC09b_assenza_totale():
    """
    Tecnico in assenza per tutti i giorni dell'orizzonte.
    → CAPACITY_EXCEEDED (nessun giorno disponibile).
    """
    giorni_assenza = [TODAY + timedelta(days=i) for i in range(3)]
    tecnico = make_tecnico(id=1, competenze=["PM"], ore_giornaliere=8, giorni_assenza=giorni_assenza)
    ticket = make_ticket(id=110, tipo="PM", durata=2.0)

    result = run([tecnico], [ticket], horizon=3)

    assert len(result.assignments) == 0
    assert len(result.unassigned) == 1
    assert result.unassigned[0].ticket_id == 110


# ── TC-10: Ticket locked escluso dalla pianificazione ────────────────────────

def test_TC10_locked_ticket_escluso():
    """
    Un ticket con assegnazione locked NON deve essere ripianificato.
    Deve solo contribuire al consumo di capacità del tecnico.
    """
    tecnico = make_tecnico(id=1, competenze=["PM"], ore_giornaliere=8)

    # Ticket 99: locked — 6h assegnate al tecnico 1 oggi
    locked_assignment = PlannerAssignment(
        ticket_id=99,
        tecnico_id=1,
        start=datetime(TODAY.year, TODAY.month, TODAY.day, 8, 0),
        end=datetime(TODAY.year, TODAY.month, TODAY.day, 14, 0),
        locked=True,
    )

    # Ticket 101: da pianificare — 2h (entra nelle 2h residue di oggi)
    ticket = make_ticket(id=101, tipo="PM", durata=2.0)

    result = run([tecnico], [ticket], assignments=[locked_assignment])

    # Ticket 99 NON deve apparire nelle assignments del risultato corrente
    ids_assegnati = [a.ticket_id for a in result.assignments]
    assert 99 not in ids_assegnati, "Il ticket locked non deve essere in assignments"
    assert len(result.unassigned) == 0, "Il ticket 101 deve essere pianificato"

    # Ticket 101 deve essere assegnato nelle ore residue (14:00-16:00)
    a101 = next(a for a in result.assignments if a.ticket_id == 101)
    assert a101.tecnico_id == 1
    assert a101.start.hour == 14, f"Deve iniziare alle 14:00, inizia alle {a101.start.hour}"
    assert a101.start.date() == TODAY


# ── TC-11: Ordinamento priorità — BD pianificato prima di PM ─────────────────

def test_TC11_priority_ordering_BD_before_PM():
    """
    Due ticket: uno BD Alta priorità, uno PM Media.
    Con un solo tecnico con capacità limitata (solo 3h/giorno, orizzonte 1 giorno),
    il ticket BD deve essere pianificato e il PM rimandato.
    """
    tecnico = make_tecnico(id=1, competenze=["PM", "BD"], ore_giornaliere=3)

    ticket_bd = make_ticket(id=201, tipo="BD", durata=3.0, priorita="Alta")
    ticket_pm = make_ticket(id=202, tipo="PM", durata=3.0, priorita="Media")

    # Ticket in ordine inverso: PM prima, BD dopo — il planner deve riordinare
    result = run([tecnico], [ticket_pm, ticket_bd], horizon=1)

    # Con 3h totali e 2 ticket da 3h, solo 1 può essere pianificato
    assert len(result.assignments) == 1, "Solo 1 ticket può essere pianificato con 3h/giorno"
    assert len(result.unassigned) == 1

    # Deve essere pianificato il BD (priorità più alta)
    assert result.assignments[0].ticket_id == 201, (
        f"BD (id=201) deve essere pianificato, ma è stato pianificato {result.assignments[0].ticket_id}"
    )
    # Il PM deve essere rimandato
    assert result.unassigned[0].ticket_id == 202, (
        f"PM (id=202) deve essere rimandato, ma è rimandato {result.unassigned[0].ticket_id}"
    )


# ── TC-12: reason_code strutturato nei deferred ───────────────────────────────

def test_TC12_reason_code_strutturato():
    """
    Un ticket con skill BD non può essere pianificato da un tecnico con solo skill PM.
    L'Unassigned deve avere reason_code == REASON_NO_SKILL e il campo non deve essere vuoto.
    """
    from backend.services.planner_engine import REASON_NO_SKILL as _NO_SKILL

    tecnico = make_tecnico(id=1, competenze=["PM"])
    ticket = make_ticket(id=112, tipo="BD", competenza="BD", durata=2.0)
    result = run([tecnico], [ticket])

    assert len(result.unassigned) == 1, "Il ticket BD deve essere deferrito (tecnico ha solo skill PM)"
    u = result.unassigned[0]
    assert u.reason_code == _NO_SKILL, (
        f"reason_code atteso={_NO_SKILL}, ottenuto={u.reason_code}"
    )
    assert u.reason_code != "", "reason_code non deve essere vuoto"


# ── TC-13: competenza_richiesta esplicita sul ticket ─────────────────────────

def test_TC13_competenza_richiesta_esplicita():
    """
    Un ticket con competenza_richiesta='ELETTRICISTA' deve essere pianificato solo
    dal tecnico con quella skill esplicita, non da un tecnico MECCANICO.
    """
    from backend.services.planner_engine import REASON_NO_SKILL as _NO_SKILL

    tecnico_ok = make_tecnico(id=1, competenze=["ELETTRICISTA", "PM", "CM", "BD"])
    tecnico_ko = make_tecnico(id=2, competenze=["MECCANICO", "PM", "CM", "BD"])
    ticket = make_ticket(id=113, tipo="PM", durata=2.0, competenza="ELETTRICISTA")

    # Solo tecnico KO → deve deferire
    result_ko = run([tecnico_ko], [ticket])
    assert len(result_ko.unassigned) == 1, "Tecnico MECCANICO non può pianificare ticket ELETTRICISTA"
    assert result_ko.unassigned[0].reason_code == _NO_SKILL

    # Solo tecnico OK → deve assegnare
    result_ok = run([tecnico_ok], [ticket])
    assert len(result_ok.assignments) == 1, "Tecnico ELETTRICISTA deve pianificare ticket ELETTRICISTA"
    assert result_ok.assignments[0].tecnico_id == 1


# ── TC-14: slot 30min — nessun overlap ────────────────────────────────────────

def test_TC14_slot_30min_no_overlap():
    """
    2 ticket da 1h sullo stesso tecnico/giorno con slot_minutes=30.
    Devono essere consecutivi, nessun overlap.
    """
    tecnico = make_tecnico(id=1, competenze=["PM"], ore_giornaliere=8)
    t1 = make_ticket(id=114, tipo="PM", durata=1.0)
    t2 = make_ticket(id=115, tipo="PM", durata=1.0)

    engine = PlannerEngine(
        [tecnico], [t1, t2], [], TODAY, horizon_days=1, slot_minutes=30
    )
    result = engine.run()

    assert len(result.assignments) == 2, f"Devono esserci 2 assegnazioni, trovate {len(result.assignments)}"
    assert len(result.unassigned) == 0

    # Ordina per start
    a1, a2 = sorted(result.assignments, key=lambda a: a.start)
    # Nessun overlap: end del primo <= start del secondo
    assert a1.end <= a2.start, (
        f"Overlap rilevato: ticket {a1.ticket_id} finisce {a1.end.strftime('%H:%M')}, "
        f"ticket {a2.ticket_id} inizia {a2.start.strftime('%H:%M')}"
    )
    # Entrambi nello stesso giorno
    assert a1.start.date() == TODAY
    assert a2.start.date() == TODAY
    # Durata attesa: 1h ciascuno
    dur1 = (a1.end - a1.start).total_seconds() / 3600
    dur2 = (a2.end - a2.start).total_seconds() / 3600
    assert abs(dur1 - 1.0) < 0.01, f"Durata ticket 1 attesa 1h, trovata {dur1}h"
    assert abs(dur2 - 1.0) < 0.01, f"Durata ticket 2 attesa 1h, trovata {dur2}h"


# ── TC-15: slot 30min — split con tecnico 2h disponibili ─────────────────────

def test_TC15_slot_30min_split():
    """
    Ticket da 3h con tecnico che ha solo 2h libere oggi (il resto è locked).
    Con slot_minutes=30, split su 2 giorni: 2h oggi + 1h domani.
    """
    from datetime import datetime as dt

    tecnico = make_tecnico(id=1, competenze=["PM"], ore_giornaliere=8)

    # Assegnazione locked che occupa 6h oggi (08:00–14:00)
    locked = PlannerAssignment(
        ticket_id=99,
        tecnico_id=1,
        start=dt(TODAY.year, TODAY.month, TODAY.day, 8, 0),
        end=dt(TODAY.year, TODAY.month, TODAY.day, 14, 0),
        locked=True,
    )

    # Ticket da 3h splittabile
    ticket = make_ticket(id=116, tipo="PM", durata=3.0, splittabile=True)

    engine = PlannerEngine(
        [tecnico], [ticket], [locked], TODAY, horizon_days=3, slot_minutes=30
    )
    result = engine.run()

    assert len(result.unassigned) == 0, f"Il ticket deve essere pianificato: {result.unassigned}"
    frags = [a for a in result.assignments if a.ticket_id == 116]
    assert len(frags) == 2, f"Devono esserci 2 frammenti, trovati {len(frags)}"

    # Frammento oggi: deve iniziare a 14:00 (fine del locked) e durare 2h
    frag_oggi = next(f for f in frags if f.start.date() == TODAY)
    dur_oggi = (frag_oggi.end - frag_oggi.start).total_seconds() / 3600
    assert abs(dur_oggi - 2.0) < 0.01, f"Frammento oggi deve essere 2h, trovato {dur_oggi}h"

    # Frammento domani: deve durare 1h
    frag_domani = next(f for f in frags if f.start.date() == TODAY + timedelta(days=1))
    dur_dom = (frag_domani.end - frag_domani.start).total_seconds() / 3600
    assert abs(dur_dom - 1.0) < 0.01, f"Frammento domani deve essere 1h, trovato {dur_dom}h"


def test_TC16_earliest_possible_date_respects_absence_and_capacity():
    """
    earliest_possible_date deve indicare il primo giorno realistico: skill corretta,
    tecnico non assente e capacita giornaliera sufficiente per ticket non splittabile.
    """
    tecnico_assente = make_tecnico(
        id=1,
        competenze=["PM"],
        ore_giornaliere=8,
        giorni_assenza=[TODAY],
    )
    ticket = make_ticket(id=117, tipo="PM", durata=8.0, splittabile=False)

    result = run([tecnico_assente], [ticket], horizon=1)

    assert len(result.assignments) == 0
    assert len(result.unassigned) == 1
    assert result.unassigned[0].earliest_possible_date == (TODAY + timedelta(days=1)).isoformat()

    tecnico_sottocapacita = make_tecnico(id=2, competenze=["PM"], ore_giornaliere=4)
    ticket_lungo = make_ticket(id=118, tipo="PM", durata=8.0, splittabile=False)

    result_no_capacity = run([tecnico_sottocapacita], [ticket_lungo], horizon=1)

    assert len(result_no_capacity.unassigned) == 1
    assert result_no_capacity.unassigned[0].earliest_possible_date is None
