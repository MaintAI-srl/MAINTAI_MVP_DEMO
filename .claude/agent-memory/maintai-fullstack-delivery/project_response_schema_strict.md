---
name: response_schema_strict_mode
description: RESPONSE_SCHEMA has strict=True; new optional fields must use anyOf with null and be in required[]
type: project
---

The OpenAI `RESPONSE_SCHEMA` in `backend/services/ai_planner_service.py` has `"strict": True`. In strict mode, all fields listed in `"properties"` must also appear in `"required"`. Optional nullable fields must use `anyOf: [{type: "string/number/..."}, {type: "null"}]` and still be listed in `required`.

**Why:** OpenAI structured output with strict mode enforces that no additional properties can be returned and all schema properties must be declared as required (even if nullable).

**How to apply:** When adding new fields to `planned_workorders` items (or any schema item with `additionalProperties: false`), always:
1. Add to `"properties"` with `anyOf: [{...}, {type: "null"}]`
2. Add to `"required"` list
The `calculate_split_assignments()` function must also propagate these fields via `wo.get("field_name", None)`.
