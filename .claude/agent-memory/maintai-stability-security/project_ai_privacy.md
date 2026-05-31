---
name: AI Privacy Anonymization Pattern
description: Which endpoints apply anonymizer.mask_text() before OpenAI calls and what the confirmed pattern looks like
type: project
---

The project uses a singleton `anonymizer = AnonymizationService()` from `backend/services/ai/anonymization_service.py`. It masks emails, phone numbers, and GPS coordinates via regex.

**Covered endpoints (as of PR #5 / branch security/codex-C-ai-imap):**
- `backend/services/ai/manuals_ai_service.py` — `extract_maintenance_tasks()` and `parse_manual_with_ai()` both call `anonymizer.mask_text(text)` before building the prompt.
- `backend/api/routes/failure_engine.py` — `analyze_ticket_failure()` masks `data.symptoms` and `data.description` (falling back to `ticket.descrizione`) before calling `analyze_failure()`.
- `backend/api/routes/guide.py` — `guide_chat()` masks only `role == "user"` messages; system prompts and page context are NOT masked (by design).

**Why:** P1-06 GDPR requirement — PII in user text must not be sent raw to external AI APIs.

**How to apply:** Any new endpoint that sends user-supplied text to OpenAI must import `anonymizer` and call `anonymizer.mask_text()` on all user-originated string fields before constructing the prompt. Do NOT mask system prompts, static context, or structured metadata.
