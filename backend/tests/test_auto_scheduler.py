"""
Test unitari per il motore di auto-scheduling (saturazione ore, no SLA).
Eseguibili con:  python -m pytest backend/tests/test_auto_scheduler.py -v
"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from backend.services.auto_scheduler import (
    SchedTechnician,
    SchedTicket,
    CalendarBlock,
    auto_schedule_tickets,
    get_working_days,
    is_ticket_schedulable,
    calculate_ticket_score,
    NON_SCHEDULABILE_DATI_MANCANTI,
    NON_SCHEDULABILE_SKILL_ASSENTE,
    NON_SCHEDULABILE_SLOT_ASSENTE,
    NON_SCHEDULABILE_MATERIALI,
    NON_SCHEDULABILE_STATO,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _next_monday(from_d: date) -> date:
    d = from_d
    while d.weekday() != 0:
        d += timedelta(days=1)
    return d


MONDAY = _next_monday(date(2026, 6, 1))  # lunedì deterministico


def make_tech(id=1, skills=None, daily=480, start="08:00", end="17:00",
              active=True, absent=None, base_site=None) -> SchedTechnician:
    return SchedTechnician(
        id=id, name=f"Tec{id}", skills=skills or ["MECCANICO"],
        workday_start=start, workday_end=end,
        daily_capacity_minutes=daily, weekly_capacity_minutes=daily * 5,
        active=active, base_site_id=base_site, absent_days=absent or [],
    )


def make_ticket(id=1, dur=120, skill="MECCANICO", priority="Media", site=1, asset=1,
                status="Aperto", crit=None, mat_ready=True, mat_req=False, age=0) -> SchedTicket:
    return SchedTicket(
        id=id, title=f"T{id}", site_id=site, asset_id=asset, status=status,
        required_skill=skill, estimated_duration_minutes=dur, priority=priority,
        asset_criticality=crit, materials_ready=mat_ready, materials_required=mat_req,
        age_days=age,
    )


def run(tickets, technicians, days=5, start=MONDAY, include_weekends=False, locked=None):
    end = start + timedelta(days=days - 1)
    return auto_schedule_tickets(
        tickets=tickets, technicians=technicians,
        calendar_blocks=locked or [], start_date=start, end_date=end,
        include_weekends=include_weekends,
    )


# ── get_working_days ──────────────────────────────────────────────────────────

def test_get_working_days_excludes_weekend():
    days = get_working_days(MONDAY, MONDAY + timedelta(days=6))
    assert len(days) == 5
    assert all(d.weekday() < 5 for d in days)


def test_get_working_days_can_include_weekend():
    days = get_working_days(MONDAY, MONDAY + timedelta(days=6), include_weekends=True)
    assert len(days) == 7


# ── Schedulabilità ────────────────────────────────────────────────────────────

def test_dati_mancanti_no_location():
    t = make_ticket(site=None, asset=None)
    ok, reason = is_ticket_schedulable(t)
    assert not ok and reason == NON_SCHEDULABILE_DATI_MANCANTI


def test_dati_mancanti_no_skill():
    t = make_ticket(skill=None)
    ok, reason = is_ticket_schedulable(t)
    assert not ok and reason == NON_SCHEDULABILE_DATI_MANCANTI


def test_materials_not_ready_excluded():
    t = make_ticket(mat_req=True, mat_ready=False)
    ok, reason = is_ticket_schedulable(t)
    assert not ok and reason == NON_SCHEDULABILE_MATERIALI


def test_closed_ticket_excluded():
    t = make_ticket(status="Chiuso")
    ok, reason = is_ticket_schedulable(t)
    assert not ok and reason == NON_SCHEDULABILE_STATO


# ── Scoring ───────────────────────────────────────────────────────────────────

def test_priority_orders_score():
    alta = calculate_ticket_score(make_ticket(priority="Alta", dur=60))
    bassa = calculate_ticket_score(make_ticket(priority="Bassa", dur=60))
    assert alta > bassa


def test_aging_increases_score():
    vecchio = calculate_ticket_score(make_ticket(age=10, dur=60))
    nuovo = calculate_ticket_score(make_ticket(age=0, dur=60))
    assert vecchio > nuovo


def test_deadline_increases_score():
    overdue = make_ticket(dur=60)
    overdue.deadline_days = -2
    normale = make_ticket(dur=60)
    assert calculate_ticket_score(overdue) > calculate_ticket_score(normale)


def test_deadline_overdue_scheduled_first_under_capacity():
    techs = [make_tech(daily=120)]  # capacità per un solo ticket da 2h/giorno
    normale = make_ticket(id=2, dur=120, priority="Bassa")
    overdue = make_ticket(id=1, dur=120, priority="Bassa")
    overdue.deadline_days = -2
    res = run([normale, overdue], techs, days=1)  # 'normale' prima nell'input
    scheduled = {a["ticket_id"] for a in res["assignments"]}
    assert 1 in scheduled and 2 not in scheduled  # vince lo scaduto


# ── Acceptance: weekend ───────────────────────────────────────────────────────

def test_no_weekend_assignments():
    techs = [make_tech()]
    # Tanti ticket per saturare e spingere oltre la settimana
    tickets = [make_ticket(id=i, dur=240) for i in range(1, 20)]
    res = run(tickets, techs, days=7)  # orizzonte include sabato/domenica
    for a in res["assignments"]:
        d = datetime.fromisoformat(a["start"]).date()
        assert d.weekday() < 5, f"assegnazione nel weekend: {d}"


# ── Acceptance: skill ─────────────────────────────────────────────────────────

def test_skill_mismatch_excluded():
    techs = [make_tech(skills=["ELETTRICISTA"])]
    tickets = [make_ticket(id=1, skill="MECCANICO")]
    res = run(tickets, techs)
    assert res["assignments"] == []
    assert res["excluded"][0]["reason"] == NON_SCHEDULABILE_SKILL_ASSENTE


def test_skill_match_assigned():
    techs = [make_tech(skills=["MECCANICO"])]
    tickets = [make_ticket(id=1, skill="MECCANICO")]
    res = run(tickets, techs)
    assert len(res["assignments"]) == 1
    assert res["assignments"][0]["technician_id"] == 1


# ── Acceptance: no overlap ────────────────────────────────────────────────────

def test_no_overlap_same_technician():
    techs = [make_tech(daily=480)]
    tickets = [make_ticket(id=i, dur=120) for i in range(1, 5)]  # 4 x 2h = 8h
    res = run(tickets, techs, days=1)
    # raccogli intervalli per tecnico/giorno
    intervals = []
    for a in res["assignments"]:
        s = datetime.fromisoformat(a["start"])
        e = datetime.fromisoformat(a["end"])
        intervals.append((s, e))
    intervals.sort()
    for (s1, e1), (s2, e2) in zip(intervals, intervals[1:]):
        assert e1 <= s2, f"sovrapposizione: {e1} > {s2}"


def test_no_overlap_with_locked_block():
    techs = [make_tech(daily=480)]
    # blocco già occupato 10:00-12:00
    locked = [CalendarBlock(
        technician_id=1, ticket_id=999,
        start=datetime.combine(MONDAY, datetime.min.time()).replace(hour=10),
        end=datetime.combine(MONDAY, datetime.min.time()).replace(hour=12),
        status="CONFIRMED", source="MANUAL",
    )]
    tickets = [make_ticket(id=1, dur=120)]
    res = run(tickets, techs, days=1, locked=locked)
    assert len(res["assignments"]) == 1
    s = datetime.fromisoformat(res["assignments"][0]["start"])
    e = datetime.fromisoformat(res["assignments"][0]["end"])
    # non deve sovrapporsi a 10-12
    assert e <= datetime.combine(MONDAY, datetime.min.time()).replace(hour=10) or \
           s >= datetime.combine(MONDAY, datetime.min.time()).replace(hour=12)


# ── Acceptance: capacità / orario ─────────────────────────────────────────────

def test_daily_capacity_not_exceeded():
    techs = [make_tech(daily=480)]
    tickets = [make_ticket(id=i, dur=180) for i in range(1, 8)]  # 7 x 3h
    res = run(tickets, techs, days=5)
    # somma minuti per giorno non supera la capacità
    per_day = {}
    for a in res["assignments"]:
        d = datetime.fromisoformat(a["start"]).date()
        per_day[d] = per_day.get(d, 0) + a["duration_minutes"]
    for d, mins in per_day.items():
        assert mins <= 480, f"capacità superata il {d}: {mins} min"


def test_not_exceeds_working_hours():
    techs = [make_tech(start="08:00", end="17:00", daily=540)]
    tickets = [make_ticket(id=i, dur=120) for i in range(1, 6)]
    res = run(tickets, techs, days=1)
    for a in res["assignments"]:
        e = datetime.fromisoformat(a["end"])
        assert e.hour * 60 + e.minute <= 17 * 60


def test_slot_assente_when_too_long():
    techs = [make_tech(daily=60, end="09:00")]  # solo 1h al giorno
    tickets = [make_ticket(id=1, dur=120)]      # serve 2h
    res = run(tickets, techs, days=5)
    assert res["assignments"] == []
    assert res["excluded"][0]["reason"] == NON_SCHEDULABILE_SLOT_ASSENTE


# ── Acceptance: saturazione ───────────────────────────────────────────────────

def test_saturation_fills_day():
    techs = [make_tech(daily=480)]
    tickets = [make_ticket(id=i, dur=120) for i in range(1, 5)]  # 4 x 2h = 8h
    res = run(tickets, techs, days=1)
    assert res["summary"]["tickets_scheduled"] == 4
    assert res["summary"]["daily_utilization_percent"] >= 99.0


def test_load_distributed_between_technicians():
    techs = [make_tech(id=1, daily=480), make_tech(id=2, daily=480)]
    # Siti distinti: il site-grouping non forza il packing su un solo tecnico,
    # quindi il bilanciamento di carico deve distribuire tra i due tecnici.
    tickets = [make_ticket(id=i, dur=120, site=i) for i in range(1, 5)]
    res = run(tickets, techs, days=1)
    used = {t["technician_id"]: t["scheduled_minutes"] for t in res["summary"]["technicians"]}
    assert used.get(1, 0) > 0 and used.get(2, 0) > 0


def test_fills_earliest_day_fully_across_technicians():
    techs = [make_tech(id=1, daily=480), make_tech(id=2, daily=480)]
    # 8 ticket da 2h, siti distinti → 16h = capacità di 2 tecnici in 1 giorno
    tickets = [make_ticket(id=i, dur=120, site=i) for i in range(1, 9)]
    res = run(tickets, techs, days=5)
    assert len(res["assignments"]) == 8
    # tutti nel primo giorno lavorativo: si riempie la giornata vicina prima
    days_used = {datetime.fromisoformat(a["start"]).date() for a in res["assignments"]}
    assert days_used == {MONDAY}
    # carico distribuito equamente sui due tecnici
    per_tech = {}
    for a in res["assignments"]:
        per_tech[a["technician_id"]] = per_tech.get(a["technician_id"], 0) + 1
    assert per_tech.get(1) == 4 and per_tech.get(2) == 4


def test_same_site_grouped_on_one_technician():
    techs = [make_tech(id=1, daily=480), make_tech(id=2, daily=480)]
    # Stesso sito: il motore accorpa gli interventi sullo stesso tecnico in giornata.
    tickets = [make_ticket(id=i, dur=120, site=1) for i in range(1, 4)]
    res = run(tickets, techs, days=1)
    tech_ids = {a["technician_id"] for a in res["assignments"]}
    assert len(tech_ids) == 1


# ── Robustezza: ticket incompleti non bloccano gli altri ──────────────────────

def test_incomplete_tickets_do_not_block_others():
    techs = [make_tech(skills=["MECCANICO"])]
    tickets = [
        make_ticket(id=1, skill="MECCANICO", dur=120),
        make_ticket(id=2, skill=None),               # dati mancanti
        make_ticket(id=3, status="Chiuso"),          # stato non valido
        make_ticket(id=4, skill="MECCANICO", dur=60),
    ]
    res = run(tickets, techs, days=5)
    scheduled_ids = {a["ticket_id"] for a in res["assignments"]}
    assert 1 in scheduled_ids and 4 in scheduled_ids
    excluded_ids = {e["ticket_id"] for e in res["excluded"]}
    assert 2 in excluded_ids and 3 in excluded_ids


# ── Spiegazioni e summary ─────────────────────────────────────────────────────

def test_assignment_has_explanation():
    res = run([make_ticket(id=1)], [make_tech()])
    assert res["assignments"][0]["reason"]
    assert "assegnato" in res["assignments"][0]["reason"].lower()


def test_summary_structure():
    res = run([make_ticket(id=1)], [make_tech()])
    s = res["summary"]
    for key in (
        "total_tickets_analyzed", "tickets_scheduled", "tickets_excluded",
        "daily_utilization_percent", "weekly_utilization_percent",
        "utilization_percent", "technicians", "technicians_saturated",
        "technicians_undersaturated",
    ):
        assert key in s, f"manca chiave summary: {key}"


# ── Integrazione bridge ORM ───────────────────────────────────────────────────

def _seed_tenant(db_session):
    from backend.db.modelli import Tenant
    tenant = Tenant(nome="Tenant AS", slug="tenant-autosched", is_active=True)
    db_session.add(tenant)
    db_session.commit()
    db_session.refresh(tenant)
    return tenant


def test_bridge_generates_plan_json(db_session):
    import asyncio
    from backend.db.modelli import Asset, Tecnico, Ticket
    from backend.services.auto_scheduler_bridge import generate_auto_schedule_plan

    tenant = _seed_tenant(db_session)
    tecnico = Tecnico(
        nome="Luca", cognome="Rossi", competenze="MECCANICO",
        ore_giornaliere=8, stato="in servizio",
        orario_inizio="08:00", orario_fine="17:00", tenant_id=tenant.id,
    )
    db_session.add(tecnico)
    asset = Asset(nome="Pompa", tenant_id=tenant.id)
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)

    for i in range(3):
        db_session.add(Ticket(
            titolo=f"Intervento {i}", asset_id=asset.id, tipo="CM",
            priorita="Media", stato="Aperto", durata_stimata_ore=2.0,
            competenza_richiesta="MECCANICO", tenant_id=tenant.id,
        ))
    db_session.commit()

    plan = asyncio.run(generate_auto_schedule_plan(
        db=db_session, days=7, tenant_id=tenant.id, start_date=MONDAY,
    ))

    assert "error" not in plan
    assert "scheduling_summary" in plan
    assert plan["scheduling_summary"]["tickets_scheduled"] == 3
    # Nessun WO nel weekend
    for wo in plan["planned_workorders"]:
        d = date.fromisoformat(wo["planned_date"])
        assert d.weekday() < 5
        assert wo["technician_id"] == tecnico.id
    assert plan.get("efficiency_score") is not None


def test_bridge_auto_extends_horizon_to_empty_backlog(db_session):
    """Il backlog viene pianificato anche oltre i 7 giorni (auto-orizzonte)."""
    import asyncio
    from backend.db.modelli import Asset, Tecnico, Ticket
    from backend.services.auto_scheduler_bridge import generate_auto_schedule_plan

    tenant = _seed_tenant(db_session)
    db_session.add(Tecnico(
        nome="Solo", competenze="Meccanico", ore_giornaliere=8, stato="in servizio",
        orario_inizio="08:00", orario_fine="17:00", tenant_id=tenant.id,
    ))
    asset = Asset(nome="A", tenant_id=tenant.id)
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)
    # 30 ticket da 2h con un solo tecnico (8h/gg) → ~8 giorni lavorativi, oltre i 7
    for i in range(30):
        db_session.add(Ticket(
            titolo=f"T{i}", asset_id=asset.id, tipo="CM", priorita="Media",
            stato="Aperto", durata_stimata_ore=2.0, competenza_richiesta="MECCANICO",
            tenant_id=tenant.id,
        ))
    db_session.commit()

    plan = asyncio.run(generate_auto_schedule_plan(
        db=db_session, days=7, tenant_id=tenant.id, start_date=MONDAY,
    ))
    assert plan["scheduling_summary"]["tickets_scheduled"] == 30
    assert plan["scheduling_summary"]["tickets_excluded"] == 0
    assert plan["plan_metadata"]["effective_days"] > 7


def test_bridge_analyzes_all_open_backlog_even_with_stale_planning_fields(db_session):
    """Ticket Aperto con vecchi planned_* non devono sparire dal backlog analizzato."""
    import asyncio
    from datetime import datetime
    from backend.db.modelli import Asset, Tecnico, Ticket
    from backend.services.auto_scheduler_bridge import generate_auto_schedule_plan

    tenant = _seed_tenant(db_session)
    db_session.add(Tecnico(
        nome="Planner", competenze="MECCANICO", ore_giornaliere=8, stato="in servizio",
        orario_inizio="08:00", orario_fine="17:00", tenant_id=tenant.id,
    ))
    asset = Asset(nome="Linea", tenant_id=tenant.id)
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)

    stale_start = datetime(2026, 6, 15, 8, 0)
    for i in range(79):
        ticket = Ticket(
            titolo=f"T{i}", asset_id=asset.id, tipo="CM", priorita="Media",
            stato="Aperto", durata_stimata_ore=0.25, competenza_richiesta="MECCANICO",
            tenant_id=tenant.id,
        )
        if i < 24:
            ticket.tecnico_id = 999
            ticket.planned_start = stale_start
            ticket.planned_finish = stale_start
            ticket.is_manual_plan = True
        db_session.add(ticket)
    db_session.commit()

    plan = asyncio.run(generate_auto_schedule_plan(
        db=db_session, days=7, tenant_id=tenant.id, start_date=MONDAY,
    ))

    assert plan["scheduling_summary"]["total_tickets_analyzed"] == 79
    assert plan["scheduling_summary"]["tickets_scheduled"] == 79
    assert plan["scheduling_summary"]["tickets_excluded"] == 0
    assert len({wo["wo_id"] for wo in plan["planned_workorders"]}) == 79


def test_bridge_summary_uses_unique_ticket_ids():
    """Il riepilogo non deve contare righe duplicate come ticket confermabili."""
    from backend.db.modelli import Ticket
    from backend.services.auto_scheduler_bridge import _normalize_plan_consistency

    plan_json = {
        "planned_workorders": [
            {"wo_id": 1, "planned_date": "2026-06-15", "planned_start_time": "08:00", "planned_end_time": "09:00"},
            {"wo_id": 1, "planned_date": "2026-06-15", "planned_start_time": "09:00", "planned_end_time": "10:00"},
        ],
        "deferred_workorders": [],
        "global_warnings": [],
        "scheduling_summary": {
            "total_tickets_analyzed": 2,
            "tickets_scheduled": 2,
            "tickets_excluded": 0,
        },
    }

    _normalize_plan_consistency(plan_json, [Ticket(id=1), Ticket(id=2)])

    assert len(plan_json["planned_workorders"]) == 1
    assert plan_json["scheduling_summary"]["total_tickets_analyzed"] == 2
    assert plan_json["scheduling_summary"]["tickets_scheduled"] == 1
    assert plan_json["scheduling_summary"]["tickets_excluded"] == 1
    assert plan_json["deferred_workorders"][0]["wo_id"] == 2


def test_bridge_distributes_across_job_skill_technicians(db_session):
    """Ticket generici (tipo) devono andare a TUTTI i tecnici, non solo a uno."""
    import asyncio
    from backend.db.modelli import Asset, Tecnico, Ticket
    from backend.services.auto_scheduler_bridge import generate_auto_schedule_plan

    tenant = _seed_tenant(db_session)
    db_session.add_all([
        Tecnico(nome="Mario", cognome="Mecc", competenze="Meccanico", ore_giornaliere=8,
                stato="in servizio", orario_inizio="08:00", orario_fine="17:00", tenant_id=tenant.id),
        Tecnico(nome="Elio", cognome="Elet", competenze="Elettricista", ore_giornaliere=8,
                stato="in servizio", orario_inizio="08:00", orario_fine="17:00", tenant_id=tenant.id),
    ])
    db_session.commit()

    assets = []
    for i in range(4):
        a = Asset(nome=f"Asset{i}", impianto_id=100 + i, tenant_id=tenant.id)
        db_session.add(a)
        assets.append(a)
    db_session.commit()
    for a in assets:
        db_session.refresh(a)
        # competenza_richiesta=None → ticket "generico" (usa il tipo come proxy)
        db_session.add(Ticket(
            titolo=f"T{a.id}", asset_id=a.id, tipo="CM", priorita="Media",
            stato="Aperto", durata_stimata_ore=2.0, tenant_id=tenant.id,
        ))
    db_session.commit()

    plan = asyncio.run(generate_auto_schedule_plan(
        db=db_session, days=7, tenant_id=tenant.id, start_date=MONDAY,
    ))
    # Tutti schedulati (skill generica copre entrambi i tecnici con job-skill)
    assert plan["scheduling_summary"]["tickets_scheduled"] == 4
    tech_ids = {wo["technician_id"] for wo in plan["planned_workorders"]}
    assert len(tech_ids) == 2  # entrambi i tecnici impiegati, non solo uno


def test_endpoint_generate_deterministic_not_blocked_by_ai_flag(client, db_session, monkeypatch):
    """L'endpoint deterministico funziona anche senza AI_PLANNING_ENABLED."""
    from backend.core.security import get_password_hash
    from backend.db.modelli import Asset, Tecnico, Ticket, Utente

    monkeypatch.delenv("AI_PLANNING_ENABLED", raising=False)
    monkeypatch.setenv("SCHEDULER_ENFORCE_SKILL", "true")
    monkeypatch.setenv("SCHEDULER_ENFORCE_MATERIALS", "true")

    tenant = _seed_tenant(db_session)
    db_session.add(Utente(
        username="planner_as", password_hash=get_password_hash("Password123!"),
        ruolo="responsabile", tenant_id=tenant.id, is_active=True,
    ))
    db_session.add(Tecnico(
        nome="Marco", competenze="MECCANICO", ore_giornaliere=8,
        stato="in servizio", orario_inizio="08:00", orario_fine="17:00", tenant_id=tenant.id,
    ))
    asset = Asset(nome="Compressore", tenant_id=tenant.id)
    db_session.add(asset)
    db_session.commit()
    db_session.refresh(asset)
    ticket = Ticket(
        titolo="Controllo", asset_id=asset.id, tipo="CM", priorita="Alta",
        stato="Aperto", durata_stimata_ore=2.0, competenza_richiesta="SOMMOZZATORE",
        in_attesa_ricambio=True, tenant_id=tenant.id,
    )
    db_session.add(ticket)
    db_session.commit()
    db_session.refresh(ticket)

    login = client.post("/auth/login", data={"username": "planner_as", "password": "Password123!"})
    assert login.status_code == 200, login.text

    res = client.post("/planning/generate", json={"days": 7, "mode": "deterministic"})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["plan_json"].get("scheduling_summary") is not None
    assert body["status"] == "draft"
    summary = body["plan_json"]["scheduling_summary"]
    assert summary["total_tickets_analyzed"] == 1
    assert summary["tickets_scheduled"] == 0
    assert summary["tickets_excluded"] == 1
    assert body["plan_json"]["deferred_workorders"][0]["wo_id"] == ticket.id
