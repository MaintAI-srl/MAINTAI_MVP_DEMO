---
name: POST /planning/replanning endpoint
description: Adaptive replanning endpoint — location, request schema, disruption_cost logic
type: project
---

**Location:** `backend/api/routes/planning.py`, at the end of the file after `ReplanningRequest` schema.

**Request schema (`ReplanningRequest`):**
- `trigger`: Literal["new_breakdown", "technician_absent", "ticket_urgent"]
- `affected_ticket_ids`: List[int] — hint, used only for response, not passed to engine
- `locked_ticket_ids`: List[int] — explicit do-not-touch list (merged with automatic locked set)
- `horizon_days`: int 1-30 (clamped by field_validator)

**Behavior:**
1. Finds previous plan (latest draft or confirmed) for disruption_cost baseline.
2. Builds locked_set = caller's locked_ticket_ids + is_manual_plan=True + stato="In corso".
3. Calls `generate_deterministic_plan(db, days, asset_ids=None, tenant_id)` — the bridge already excludes locked tickets from the schedulable queue automatically.
4. Saves result as a new "draft" GeneratedPlan.
5. Computes disruption_cost: count of WOs that changed technician_id or planned_date vs the previous plan.
6. Returns: replanning_plan_id, trigger, affected_tickets, moved_tickets, disruption_cost, plan_json.

**Note on locked_set usage:** The locked_set is built for transparency/logging but NOT explicitly passed to the bridge, because the bridge already excludes locked tickets by querying only stato=Aperto/Pianificato tickets without tecnico_id+planned_start. The locked_set feeds only the disruption_cost diff calculation.

**db_error signature:** `db_error(db, "PLANNING", msg, tenant_id=tenant_id)` — the `db` session is the first positional arg (differs from some other call sites that omit it).
