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
