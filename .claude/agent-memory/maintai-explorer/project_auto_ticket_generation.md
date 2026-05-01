---
name: Auto Ticket Generation Architecture
description: The generation_mode='auto' field exists in the ORM and schema but has NO background job that actually triggers automatic ticket creation. Auto-generation is a dead feature path.
type: project
---

`generation_mode` on `AttivitaManutenzione` has three values: `manual | auto | disabled`. The field is persisted, exposed in APIs, and shown in the UI. However, there is **no background task, cron job, or scheduler that reads tasks with `generation_mode='auto'` and creates tickets**.

The two background tasks running at startup (`main.py` lifespan) are:
1. `email_poller_task` — polls IMAP every 5 minutes for email-to-ticket
2. `run_retention_job` — deletes soft-deleted tickets older than 30 days

Neither touches `AttivitaManutenzione`.

`generate_days_before_due` (default: 7) is stored in the DB and returned in all task API responses, but is never consumed by any logic. It represents "generate ticket N days before next due date" but no consumer exists.

**Where the field SHOULD be consumed:** A background job (like the retention job pattern) needs to:
1. Query tasks with `generation_mode='auto'` and `task_stato='active'` and `frequenza_giorni IS NOT NULL`
2. Compute `next_due_at` for each task
3. Check if `next_due_at - now <= generate_days_before_due days`
4. If so, and no active ticket exists, call the genera-ticket logic

**Adding `giorni_anticipo_generazione`:** This field is redundant — `generate_days_before_due` already serves exactly that purpose. The missing piece is the background job that reads it.

**Why:** The auto-generation background job was designed but never implemented. The field and UI plumbing are complete; only the execution engine is missing.

**How to apply:** When asked to implement auto ticket generation, wire `generate_days_before_due` into a new background loop (similar to `retention_service.py` pattern) — do NOT add a new field.
