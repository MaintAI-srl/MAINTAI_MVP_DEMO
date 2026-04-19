---
name: Planner architecture current state
description: What is already built vs what was missing — snapshot as of 2026-04-19
type: project
---

## Already built (do not re-implement)

- `planner_engine.py`: complete — slot tracking, helpers, `_try_allocate`, `_schedule_ticket`, `_make_assignment`, `_ore_libere`, `_commit_allocation`, all REASON_* constants, TC-01..TC-15 tests.
- `planner_engine_bridge.py`: complete — ORM→PlannerEngine conversion, adaptive estimator integration, `_build_planner_tickets(db=, tenant_id=)` signature, `slot_minutes=30` passed to engine.
- `adaptive_estimator.py`: complete — `get_duration_correction_factor()` with asset-specific then type-generic fallback, cap [0.5, 3.0], lookback 90d, min 5 records.
- `planning.py`: `ReplanningRequest` pydantic schema was already defined. `POST /planning/replanning` endpoint added in this session.
- `PlannerFeedback` ORM model: exists in `backend/db/modelli.py`, used by adaptive estimator and feedback endpoints.

## Implicit competence workaround (bridge)

`_TIPO_IMPLICITI = ["PM", "CM", "BD"]` — added to every active technician's competenze list in `_build_planner_tecnici`. This means the engine skill check (`competenza_richiesta` = ticket.tipo) always passes unless the ticket has an explicit `competenza_richiesta` field (e.g. "ELETTRICISTA").

## Locked ticket logic

A ticket is "locked" (not re-plannable) if it has BOTH `tecnico_id` AND `planned_start` set, OR if `is_manual_plan=True`. Locked tickets consume capacity but are not scheduled again.
