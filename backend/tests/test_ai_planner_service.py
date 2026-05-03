from types import SimpleNamespace
from datetime import date

from backend.services.ai_planner_service import _tecnico_has_skill, calculate_plan_efficiency


def test_ai_skill_matching_respects_explicit_competenza():
    tecnico_meccanico = SimpleNamespace(competenze="MECCANICO, PM")
    ticket_elettrico = SimpleNamespace(competenza_richiesta="ELETTRICISTA", tipo="PM")

    assert _tecnico_has_skill(tecnico_meccanico, ticket_elettrico) is False

    tecnico_elettrico = SimpleNamespace(competenze="ELETTRICISTA")
    assert _tecnico_has_skill(tecnico_elettrico, ticket_elettrico) is True


def test_efficiency_uses_effective_hours_with_absences():
    plan = {
        "planned_workorders": [
            {"wo_id": 1, "duration_hours": 8, "tipo": "PM"},
        ],
        "deferred_workorders": [],
    }
    technicians = [{"id": 1, "ore_giornaliere": 8}]

    result = calculate_plan_efficiency(
        plan,
        technicians,
        total_backlog=1,
        plan_start_date=date(2026, 4, 6),
        plan_end_date=date(2026, 4, 10),
        absences={1: [date(2026, 4, 6), date(2026, 4, 7)]},
    )

    assert result["ore_disponibili_teoriche"] == 40
    assert result["ore_disponibili_effettive"] == 24
    assert result["ore_assegnate"] == 8
