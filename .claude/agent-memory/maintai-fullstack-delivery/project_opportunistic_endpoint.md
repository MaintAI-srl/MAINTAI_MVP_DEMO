---
name: opportunistic_endpoint
description: GET /planning/opportunistic endpoint and opportunistic_service.py are implemented
type: project
---

The opportunistic maintenance endpoint (`GET /planning/opportunistic`) is implemented as of 2026-04-19.

- Service: `backend/services/opportunistic_service.py` — `find_opportunistic_suggestions()` computes insertion_score = 0.4*proximity + 0.4*urgency + 0.2*fit
- Route: `backend/api/routes/planning.py` — GET `/planning/opportunistic?technician_id=&date=&free_slot_hours=2.0`
- Returns top-5 PM candidates for opportunistic scheduling when a technician has free slots

**Why:** Feature request to suggest PM tickets when a technician has spare time at an impianto already being serviced.

**How to apply:** When building opportunistic scheduling UIs, call this endpoint from the frontend with the technician ID, date, and available hours.
