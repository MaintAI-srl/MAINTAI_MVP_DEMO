---
name: Security Audit Findings 2026-06-08
description: Complete security audit findings for production-readiness, covering auth, multi-tenancy, input validation, file uploads, AI/LLM, rate limiting, secrets, email poller, error handling, dependencies
type: project
---

Key findings from full audit conducted 2026-06-08:

**NEW ISSUES FOUND (not in previous audit):**

1. **ALTA**: `GeneratePlanRequest.days` field has no bounds validator — attacker can pass `days=3650` causing ~10 years of AI context generation (CPU/OpenAI cost DoS). Fix: `Field(default=7, ge=1, le=90)`.

2. **ALTA**: Ticket allegati upload (`POST /tickets/{ticket_id}/allegati`) validates extension only (not magic bytes). Unlike manuali.py which uses `sniff_ext()`, tickets.py only checks `os.path.splitext()`. An attacker can upload HTML/JS renamed as .pdf. Fix: add `validate_magic()` call from `backend.core.file_validation`.

3. **ALTA**: Exception messages exposed in HTTP 500 responses in `planning.py` lines 370 and 776: `detail=f"Errore interno: {exc}"` and `detail=f"Errore durante la conferma del piano: {exc}"`. Same pattern in `asset_documenti.py` lines 242, 257, and `assets.py` lines 251, 279. Fix: log exc server-side, return generic message.

4. **MEDIA**: `VoceCheck.label` and `VoceCheck.descrizione` in `check_primo_livello.py` have no `max_length` validators. An authenticated user can store huge payloads in the `voci` JSON column. Fix: `label: str = Field(..., max_length=200)`, `descrizione: Optional[str] = Field(None, max_length=1000)`.

5. **MEDIA**: `feedback_analytics` endpoint `days` query param (planning.py line 1430) has no bounds — can be set to arbitrary values causing full table scan. Fix: `days: int = Query(30, ge=1, le=365)`.

6. **MEDIA**: `DeauthorizeRequest.reason` has no `max_length` — can store unlimited text in deauthorization_reason column. Fix: `reason: str = Field(..., min_length=5, max_length=2000)`.

7. **MEDIA**: `MailBox()` in email_poller.py line 54 uses default SSL (port 993 implicitly SSL via imap_tools) but no explicit `ssl_context` is set and there is no connection timeout on the fetch loop. The IMAP login itself has a timeout in `_test_imap()` but the background `parse_and_create_tickets()` IMAP session has no timeout. Fix: add `timeout=30` parameter.

8. **MEDIA**: `RevokedToken` JTI blacklist table is never cleaned up. After every logout a row is added but never deleted; `token_version` mechanism already handles password-change revocation. Over time this table grows unboundedly. Fix: add cleanup to retention_service (delete RevokedTokens older than ACCESS_TOKEN_EXPIRE_MINUTES).

9. **BASSA**: `db_error(db, "PLANNING", ...)` call at planning.py line 1197 passes `db` as first arg — this is handled by `_normalize_args()` in logger_db.py so it works but is an anti-pattern inconsistency. Same in piano_manutenzione.py line 292.

10. **BASSA**: `COOKIE_SAMESITE` defaults to `"lax"` which is correct for same-origin SPA. However `lax` + cookies allow cross-site GET navigation. The CSRF middleware already handles this but should be documented.

11. **BASSA**: `PyPDF2` (version 3.0.1) is deprecated upstream (last release 2023); the modern fork is `pypdf`. No known active CVEs but consider migration to `pypdf>=4.0.0`.

12. **BASSA**: `has_openai_key` boolean disclosed in `/planning/status` response (line 885). Low risk (no key value, just bool) but reveals infrastructure info. Consider removing from public-facing response.

**CONFIRMED GOOD PATTERNS:**
- JWT: no fallback, fail-fast, HS256 only, 24h TTL, JTI blacklist, token_version
- Multi-tenant: `with_loader_criteria` ORM-level tenant filter + `current_tenant_id` ContextVar — automatic filter on all SELECTs
- CORS: localhost blocked in production via `IS_PRODUCTION` check
- Rate limiting: login (20/min), AI endpoints (5-10/min), QR endpoints (30/min), manuali (10/min)
- CSRF middleware: origin/referer check on state-changing methods, fail-closed
- Magic bytes: manuali + asset_documenti use `validate_magic()` from file_validation.py
- IMAP SSRF: `_validate_imap_server()` DNS-resolves and checks private CIDR ranges
- Fernet encryption: IMAP passwords encrypted at rest, fail-fast if ENCRYPTION_KEY missing
- Security headers: present on both FastAPI (middleware) and Next.js (next.config.ts)
- HSTS: only in production via `IS_PRODUCTION`
- Error handling: `generic_error_handler` catches unhandled exceptions, returns generic 500 (but individual routes still leak exc details — see finding #3)

**Why:** Comprehensive audit requested to bring codebase to commercial production-ready state.
**How to apply:** Apply findings in priority order. Highest risk is #1 (planning DoS) and #3 (error leakage) and #2 (file upload).
