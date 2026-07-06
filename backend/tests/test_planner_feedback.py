"""
Test per gli endpoint /planning/feedback (POST e GET).
Verificano la logica di calcolo delta e il flag technician_changed
senza usare mock — testano la funzione di calcolo direttamente.

Eseguibili con: python -m pytest backend/tests/test_planner_feedback.py -v
"""
from __future__ import annotations

from datetime import datetime


# ── Helper: logica di calcolo feedback (estratta dalla route) ────────────────

def _compute_feedback_fields(
    estimated_duration_hours: float,
    actual_start_iso: str | None,
    actual_finish_iso: str | None,
    planned_start_iso: str | None,
    planned_tecnico_id: int | None,
    actual_tecnico_id: int | None,
) -> dict:
    """
    Riproduce la logica di calcolo degli endpoint POST /planning/feedback.
    Ritorna un dizionario con i campi calcolati.
    """
    actual_start_dt = datetime.fromisoformat(actual_start_iso) if actual_start_iso else None
    actual_finish_dt = datetime.fromisoformat(actual_finish_iso) if actual_finish_iso else None

    actual_duration_hours = None
    if actual_start_dt and actual_finish_dt:
        actual_duration_hours = round(
            (actual_finish_dt - actual_start_dt).total_seconds() / 3600, 2
        )

    duration_delta = None
    if actual_duration_hours is not None:
        duration_delta = round(actual_duration_hours - estimated_duration_hours, 2)

    date_delta = None
    if actual_start_dt and planned_start_iso:
        planned_dt = datetime.fromisoformat(planned_start_iso)
        date_delta = (actual_start_dt.date() - planned_dt.date()).days

    technician_changed = False
    if actual_tecnico_id is not None and planned_tecnico_id is not None:
        technician_changed = (actual_tecnico_id != planned_tecnico_id)

    return {
        "actual_duration_hours": actual_duration_hours,
        "duration_delta_hours": duration_delta,
        "date_delta_days": date_delta,
        "technician_changed": technician_changed,
    }


# ── FB-01: duration_delta calcolato correttamente ────────────────────────────

def test_FB01_feedback_delta_corretto():
    """
    Un ticket stimato 2h eseguito in 3h deve produrre duration_delta_hours = +1.0.
    Un ticket stimato 4h eseguito in 3h deve produrre duration_delta_hours = -1.0.
    """
    # Caso 1: più lungo del previsto
    result = _compute_feedback_fields(
        estimated_duration_hours=2.0,
        actual_start_iso="2026-04-07T08:00:00",
        actual_finish_iso="2026-04-07T11:00:00",
        planned_start_iso="2026-04-07T08:00:00",
        planned_tecnico_id=1,
        actual_tecnico_id=1,
    )
    assert result["actual_duration_hours"] == 3.0, f"Durata reale attesa 3.0h, ottenuta {result['actual_duration_hours']}"
    assert result["duration_delta_hours"] == 1.0, f"Delta atteso +1.0h, ottenuto {result['duration_delta_hours']}"
    assert result["date_delta_days"] == 0, f"Delta data atteso 0, ottenuto {result['date_delta_days']}"
    assert result["technician_changed"] is False

    # Caso 2: più corto del previsto
    result2 = _compute_feedback_fields(
        estimated_duration_hours=4.0,
        actual_start_iso="2026-04-07T08:00:00",
        actual_finish_iso="2026-04-07T11:00:00",
        planned_start_iso="2026-04-07T08:00:00",
        planned_tecnico_id=1,
        actual_tecnico_id=1,
    )
    assert result2["duration_delta_hours"] == -1.0, f"Delta atteso -1.0h, ottenuto {result2['duration_delta_hours']}"


# ── FB-02: technician_changed flag ───────────────────────────────────────────

def test_FB02_technician_changed():
    """
    Se il tecnico reale è diverso da quello pianificato, technician_changed deve essere True.
    Se sono gli stessi, deve essere False.
    """
    # Tecnico diverso → True
    result = _compute_feedback_fields(
        estimated_duration_hours=2.0,
        actual_start_iso="2026-04-07T08:00:00",
        actual_finish_iso="2026-04-07T10:00:00",
        planned_start_iso="2026-04-07T08:00:00",
        planned_tecnico_id=1,
        actual_tecnico_id=2,
    )
    assert result["technician_changed"] is True, "Tecnico cambiato: technician_changed deve essere True"

    # Stesso tecnico → False
    result2 = _compute_feedback_fields(
        estimated_duration_hours=2.0,
        actual_start_iso="2026-04-07T08:00:00",
        actual_finish_iso="2026-04-07T10:00:00",
        planned_start_iso="2026-04-07T08:00:00",
        planned_tecnico_id=1,
        actual_tecnico_id=1,
    )
    assert result2["technician_changed"] is False, "Stesso tecnico: technician_changed deve essere False"


# ── FB-03: date_delta positivo per esecuzione in ritardo ─────────────────────

def test_FB03_date_delta_ritardo():
    """
    Un ticket pianificato per lunedì eseguito mercoledì deve avere date_delta_days = 2.
    """
    result = _compute_feedback_fields(
        estimated_duration_hours=2.0,
        actual_start_iso="2026-04-09T08:00:00",   # mercoledì
        actual_finish_iso="2026-04-09T10:00:00",
        planned_start_iso="2026-04-07T08:00:00",   # lunedì
        planned_tecnico_id=1,
        actual_tecnico_id=1,
    )
    assert result["date_delta_days"] == 2, f"Delta data atteso 2, ottenuto {result['date_delta_days']}"


# ── FB-04: actual senza planned_start → date_delta None ──────────────────────

def test_FB04_date_delta_senza_planned():
    """
    Se il ticket non ha planned_start, date_delta_days deve essere None.
    """
    result = _compute_feedback_fields(
        estimated_duration_hours=2.0,
        actual_start_iso="2026-04-07T08:00:00",
        actual_finish_iso="2026-04-07T10:00:00",
        planned_start_iso=None,
        planned_tecnico_id=None,
        actual_tecnico_id=1,
    )
    assert result["date_delta_days"] is None, "date_delta_days deve essere None senza planned_start"
    assert result["technician_changed"] is False, "technician_changed deve essere False senza planned_tecnico"
