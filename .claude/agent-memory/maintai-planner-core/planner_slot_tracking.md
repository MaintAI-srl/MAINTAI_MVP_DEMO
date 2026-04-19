---
name: Slot 30min tracking
description: Slot-based capacity tracking in PlannerEngine — implementation status and bridge activation
type: project
---

The PlannerEngine supports two capacity-tracking modes:
- `slot_minutes=None` (legacy): float `ore_consumate` per tecnico/day — backward compat, all legacy TCs pass unchanged.
- `slot_minutes=30` (active): `slot_grid[tecnico_id][day] = List[bool]` — 30min granularity, prevents sub-hour overlaps.

**Bridge activation:** `planner_engine_bridge.py` passes `slot_minutes=30` to PlannerEngine in `generate_deterministic_plan()`. This was the missing piece added in the session.

**Engine helpers (all in planner_engine.py):**
- `_slots_needed(durata_ore, slot_minutes)` — ceil(h*60/sm)
- `_find_free_block(grid, slots_needed)` — first consecutive free block
- `_slot_to_ore_float(slot_idx, orario_inizio, slot_minutes)` — idx → float hour
- `_ore_libere(tecnico, giorno)` — dispatches to slot or float mode
- `_commit_allocation(tecnico, giorno, durata, assignment)` — updates slot_grid + ore_consumate (derived view)
- `_make_assignment(...)` — uses `_find_free_block` in slot mode for exact start/end

**Tests:** TC-14 (no overlap, 2 x 1h tickets) and TC-15 (split: 6h locked + 3h ticket → 2h today + 1h tomorrow) both pass.

**Why:** slot tracking ensures that two tickets allocated the same day never visually overlap on the Gantt, even if both fit within float-hour capacity.
