"""
Test unitari per Felix Agent (backend/services/ai/planning_agent_service.py).

Coprono SOLO la logica pura (contesto → PlannerEngine, valutazione candidati,
sanitizzazione output): nessuna chiamata OpenAI, nessun SDK richiesto a runtime.
"""
from datetime import date, timedelta

from backend.services.ai.planning_agent_service import (
    AgentPlanOutput,
    PlanningAgentContext,
    build_planner_inputs_from_context,
    evaluate_candidate_plan,
    run_baseline_from_context,
    sanitize_agent_plan,
)


def _next_monday() -> date:
    today = date.today()
    return today + timedelta(days=(7 - today.weekday()) % 7 or 7)


def _make_ctx(**overrides) -> PlanningAgentContext:
    monday = _next_monday()
    horizon = [(monday + timedelta(days=i)).isoformat() for i in range(5)]  # Lun-Ven
    defaults = dict(
        horizon_dates=horizon,
        tickets=[
            {
                "id": 1, "titolo": "Guasto pompa", "tipo": "BD", "priorita": "Alta",
                "durata_stimata_ore": 2.0, "competenza_richiesta": None,
                "asset_id": 10, "asset_area": "Area A",
                "qualified_tecnici_ids": [100, 200], "weather_violations": {},
            },
            {
                "id": 2, "titolo": "Ispezione quadro", "tipo": "PM", "priorita": "Media",
                "durata_stimata_ore": 4.0, "competenza_richiesta": None,
                "asset_id": 20, "asset_area": "Area B",
                "qualified_tecnici_ids": [100], "weather_violations": {horizon[0]: "Pioggia prevista"},
            },
        ],
        locked_tickets=[
            {
                "id": 99, "tecnico_id": 100,
                "planned_start": f"{horizon[0]}T08:00:00",
                "planned_finish": f"{horizon[0]}T10:00:00",
                "durata_stimata_ore": 2.0,
            },
        ],
        tecnici=[
            {
                "id": 100, "nome": "Tecnico-100", "competenze": "PM, CM, BD",
                "ore_giornaliere": 8, "orario_inizio": "08:00", "orario_fine": "17:00",
                "giorni_assenza": [],
            },
            {
                "id": 200, "nome": "Tecnico-200", "competenze": "MECCANICO, BD",
                "ore_giornaliere": 8, "orario_inizio": "08:00", "orario_fine": "17:00",
                "giorni_assenza": [horizon[1]],
            },
        ],
        days=5,
        include_weekends=False,
        workday_end_hour=17,
    )
    defaults.update(overrides)
    return PlanningAgentContext(**defaults)


# ── build_planner_inputs_from_context ─────────────────────────────────────────

def test_build_inputs_adds_implicit_skills_only_without_job_skills():
    ctx = _make_ctx()
    tecnici, tickets, assignments = build_planner_inputs_from_context(ctx)

    generico = next(t for t in tecnici if t.id == 100)
    meccanico = next(t for t in tecnici if t.id == 200)
    # Tecnico senza job-skill: PM/CM/BD già presenti restano
    assert {"PM", "CM", "BD"} <= set(generico.competenze)
    # Tecnico con job-skill (MECCANICO): nessuna aggiunta implicita di PM/CM
    assert "MECCANICO" in meccanico.competenze
    assert "PM" not in meccanico.competenze
    assert "CM" not in meccanico.competenze

    assert len(tickets) == 2
    assert len(assignments) == 1 and assignments[0].locked is True


def test_build_inputs_maps_weather_violations_to_non_operative_days():
    ctx = _make_ctx()
    _, tickets, _ = build_planner_inputs_from_context(ctx)
    t2 = next(t for t in tickets if t.id == 2)
    assert date.fromisoformat(ctx.horizon_dates[0]) in t2.giorni_non_operativi


def test_build_inputs_absences_parsed_as_dates():
    ctx = _make_ctx()
    tecnici, _, _ = build_planner_inputs_from_context(ctx)
    meccanico = next(t for t in tecnici if t.id == 200)
    assert meccanico.giorni_assenza == [date.fromisoformat(ctx.horizon_dates[1])]


# ── run_baseline_from_context ─────────────────────────────────────────────────

def test_baseline_plans_every_ticket_and_is_cached():
    ctx = _make_ctx()
    baseline = run_baseline_from_context(ctx)

    planned_ids = {w["wo_id"] for w in baseline["planned_workorders"]}
    deferred_ids = {d["wo_id"] for d in baseline["deferred_workorders"]}
    assert planned_ids | deferred_ids == {1, 2}
    assert planned_ids.isdisjoint(deferred_ids)
    # Cache: seconda chiamata restituisce lo stesso oggetto
    assert run_baseline_from_context(ctx) is baseline


def test_baseline_passes_evaluation_without_violations():
    """Il piano deterministico deve essere valido per i vincoli hard del valutatore."""
    ctx = _make_ctx()
    baseline = run_baseline_from_context(ctx)
    result = evaluate_candidate_plan(
        ctx,
        [w for w in baseline["planned_workorders"] if not w.get("is_continuation")],
        baseline["deferred_workorders"],
    )
    assert result["valido"] is True, result["violazioni"]


# ── evaluate_candidate_plan ───────────────────────────────────────────────────

def test_evaluate_flags_unqualified_technician():
    ctx = _make_ctx()
    result = evaluate_candidate_plan(
        ctx,
        [{"wo_id": 2, "technician_id": 200, "planned_date": ctx.horizon_dates[2], "duration_hours": 4.0}],
        [{"wo_id": 1, "reason": "test"}],
    )
    assert result["valido"] is False
    assert any("competenze" in v for v in result["violazioni"])


def test_evaluate_flags_absence_day():
    ctx = _make_ctx()
    result = evaluate_candidate_plan(
        ctx,
        [{"wo_id": 1, "technician_id": 200, "planned_date": ctx.horizon_dates[1], "duration_hours": 2.0}],
        [{"wo_id": 2, "reason": "test"}],
    )
    assert any("assente" in v for v in result["violazioni"])


def test_evaluate_flags_capacity_overflow_including_locked_hours():
    ctx = _make_ctx()
    # Tecnico 100 ha già 2h locked il primo giorno: 7h aggiuntive superano 8h+0.5 tolleranza
    result = evaluate_candidate_plan(
        ctx,
        [{"wo_id": 1, "technician_id": 100, "planned_date": ctx.horizon_dates[0], "duration_hours": 7.0}],
        [{"wo_id": 2, "reason": "test"}],
    )
    assert any("capacità" in v.lower() for v in result["violazioni"])


def test_evaluate_flags_missing_and_unknown_and_locked_tickets():
    ctx = _make_ctx()
    result = evaluate_candidate_plan(
        ctx,
        [
            {"wo_id": 99, "technician_id": 100, "planned_date": ctx.horizon_dates[0], "duration_hours": 1.0},
            {"wo_id": 777, "technician_id": 100, "planned_date": ctx.horizon_dates[0], "duration_hours": 1.0},
        ],
        [],
    )
    assert any("bloccato" in v for v in result["violazioni"])          # locked #99
    assert any("inesistente" in v for v in result["violazioni"])        # sconosciuto #777
    assert any("assente dal piano" in v for v in result["violazioni"])  # mancanti #1 e #2


def test_evaluate_out_of_horizon_date():
    ctx = _make_ctx()
    result = evaluate_candidate_plan(
        ctx,
        [{"wo_id": 1, "technician_id": 100, "planned_date": "2030-01-01", "duration_hours": 2.0}],
        [{"wo_id": 2, "reason": "test"}],
    )
    assert any("orizzonte" in v for v in result["violazioni"])


def test_evaluate_weather_violation_is_warning_not_blocking():
    ctx = _make_ctx()
    result = evaluate_candidate_plan(
        ctx,
        [
            {"wo_id": 2, "technician_id": 100, "planned_date": ctx.horizon_dates[0], "duration_hours": 4.0},
            {"wo_id": 1, "technician_id": 200, "planned_date": ctx.horizon_dates[0], "duration_hours": 2.0},
        ],
        [],
    )
    assert result["valido"] is True, result["violazioni"]
    assert any("Pioggia" in a for a in result["avvisi"])
    assert "efficiency_score" in result and "efficiency_breakdown" in result


# ── sanitize_agent_plan ───────────────────────────────────────────────────────

def test_sanitize_removes_unknown_locked_and_duplicates():
    ctx = _make_ctx()
    plan = {
        "planned_workorders": [
            {"wo_id": 1, "technician_id": 100, "planned_date": ctx.horizon_dates[0], "time_slot": "08:00-10:00"},
            {"wo_id": 1, "technician_id": 200, "planned_date": ctx.horizon_dates[2], "time_slot": "08:00-10:00"},  # duplicato
            {"wo_id": 99, "technician_id": 100, "planned_date": ctx.horizon_dates[0], "time_slot": "10:00-11:00"},  # locked
            {"wo_id": 777, "technician_id": 100, "planned_date": ctx.horizon_dates[0], "time_slot": "11:00-12:00"},  # sconosciuto
        ],
        "deferred_workorders": [
            {"wo_id": 1, "reason": "doppione da scartare"},  # già planned
        ],
        "fermo_assets": [{"asset_id": 10, "triggered_by_wo_id": 777}],
        "global_warnings": [],
    }
    out = sanitize_agent_plan(ctx, plan)

    assert [w["wo_id"] for w in out["planned_workorders"]] == [1]
    # Il ticket 2, dimenticato dall'agente, finisce in deferred con reason esplicita
    deferred_map = {d["wo_id"]: d for d in out["deferred_workorders"]}
    assert set(deferred_map) == {2}
    assert deferred_map[2].get("reason_code") == "AGENT_MISSING"
    # fermo_assets con trigger non pianificato viene scartato
    assert out["fermo_assets"] == []
    assert any("rimossi" in w for w in out["global_warnings"])


def test_agent_output_model_matches_plan_json_shape():
    out = AgentPlanOutput(
        planned_workorders=[{
            "wo_id": 1, "technician_id": 100, "planned_date": "2026-07-13",
            "time_slot": "08:00-10:00", "motivation": "test", "warnings": [],
            "confidence_score": 0.9, "risk_level": "LOW", "complexity": "SIMPLE",
        }],
        deferred_workorders=[{"wo_id": 2, "reason": "materiali mancanti"}],
        fermo_assets=[],
        global_warnings=[],
    )
    dumped = out.model_dump()
    assert set(dumped) == {"planned_workorders", "deferred_workorders", "fermo_assets", "global_warnings"}
    assert dumped["planned_workorders"][0]["wo_id"] == 1
