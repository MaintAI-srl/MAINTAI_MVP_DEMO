# MaintAI — Sales Readiness Security Checklist

**Data:** 2026-07-04 · **Versione:** 1.3 · **Piattaforma:** MaintAI 3.3.1
**Stato verificato dal codice del branch** `claude/code-security-debug-a8uuhz` (su `main` @ `e8a1b76`).

Legenda: ✅ Conforme · 🔄 Parziale/backlog · ❌ Mancante

## Autenticazione e Accesso
- [✅] JWT con expiry configurato (access 24h via `ACCESS_TOKEN_EXPIRE_MINUTES`)
- [🔄] Refresh token con rotazione — *non presente; solo access token (SEC-010)*
- [✅] Password hashing: **bcrypt** (`bcrypt==5.0.0`)
- [✅] Password min length ≥12 + complessità completa (SEC-009 chiuso 2026-06-11, policy centralizzata in `core/security.py`)
- [✅] Rate limiting su `/auth/login` (slowapi, **5/min per IP**) + alerting brute-force via `security_monitor` (SEC-008 chiuso 2026-06-11)
- [✅] RBAC su route sensibili (`require_roles`/`require_superadmin`, 30/33 file route)
- [✅] Tenant isolation verificata (`tenant_id` + `check_tenant_ownership` → 404)
- [✅] Revoca sessione (logout blacklist JTI + `token_version` su cambio password)
- [🔄] Sessione timeout per inattività — *coperto da expiry token; idle-timeout esplicito non implementato*
- [🔄] MFA — *non disponibile (SEC-006)*

## Trasporto e Headers
- [✅] HTTPS enforced (Vercel/Render) + HSTS in produzione
- [✅] CORS con origins espliciti (no wildcard), split prod/dev
- [✅] Anti-CSRF (Origin/Referer, fail-closed) su richieste mutanti
- [✅] Security headers backend (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS)
- [✅] Security headers frontend (CSP, `X-Frame-Options: DENY`, ecc. in `next.config.ts`)
- [✅] Nessun header che espone stack (header `Server` di uvicorn rimosso in produzione con `--no-server-header`)

## Codice e Dipendenze
- [✅] No SQL injection (SQLAlchemy ORM; nessuna f-string su input utente)
- [✅] Validazione Pydantic sugli input
- [✅] No hardcoded secrets (grep su `sk-`, `postgres://`, `SECRET_KEY=...`: 0 in codice)
- [✅] `.env.example` aggiornato e `.gitignore` corretto (`.env`, `*.key`, `*.pem`, signing key)
- [✅] **pip-audit** (ri-eseguito 2026-07-04): **0 vulnerabilità** — chiusi SEC-021 (`python-multipart` 3 CVE) e SEC-022 (`cryptography`)
- [✅] **bandit** (ri-eseguito 2026-07-04): 0 issue HIGH (2 MEDIUM = falsi positivi documentati)
- [✅] **npm audit** (ri-eseguito 2026-07-04): 0 HIGH/CRITICAL — chiuso SEC-023 (`hono`/`js-yaml`/`@babel` dev-tooling); 2 MODERATE build-time accettati (postcss via next)
- [✅] **Anti-DoS input** (SEC-024): parametri `mesi`/`days` con bound espliciti su report, planner e analytics
- [✅] **No formula/CSV injection** (SEC-025): export CSV ed Excel neutralizzati (`sanitize_spreadsheet_cell`)
- [✅] **Gate qualità frontend** (2026-07-04): `npm run lint` 0 errori **e 0 warning** (56 warning residui azzerati), `tsc --noEmit` 0 errori, `npm run build` completo

## Database
- [📋] RLS PostgreSQL — *l'app accede al DB solo via backend autenticato (no client diretto); RLS difesa-in-profondità consigliata (SEC-011)*
- [✅] Connessione con `sslmode=require` (documentato in `.env.example`/`SECURITY.md`)
- [✅] Backup automatici Supabase (cifrati) — *test restore trimestrale in backlog*
- [✅] Nessuna credenziale DB nel codice

## Logging e Compliance
- [✅] Audit log strutturato attivo (`SystemLog`)
- [✅] Log retention 12 mesi enforced (`cleanup_old_system_logs`, minimo 365gg non riducibile — SEC-007 chiuso 2026-06-11)
- [✅] `SECURITY.md` completo
- [✅] ISO 27001 Controls Mapping completato
- [✅] NIS2 Compliance document completato
- [🔄] GDPR privacy notice — *sezione in `SECURITY.md`; notice cliente-facing da formalizzare*
- [🔄] DPA template pronto per clienti

## Documentazione Vendita
- [🔄] Security questionnaire template (procurement enterprise) — *backlog*
- [🔄] One-pager sicurezza per il sales team — *backlog*
- [✅] Riferimenti certificazioni fornitori (SOC2 Supabase/Vercel/Render) — `NIS2_COMPLIANCE.md`

---

## Punteggio

| Esito | Conteggio |
|---|---|
| ✅ Conforme | 24 |
| 🔄 Parziale/backlog | 6 |
| 📋 / ❌ | 1 |

**Giudizio: CONDITIONAL READY.** Tutti i controlli **tecnici core** di sicurezza sono
in posizione e le vulnerabilità HIGH delle dipendenze sono risolte. Il completamento dei
punti 🔄 residui (MFA, refresh token rotation, DPA/privacy notice, test restore,
materiali sales) porta allo stato **READY FOR SALE** per clienti enterprise/NIS2.
Rispetto alla v1.0: chiusi SEC-007, SEC-008 e SEC-009 (2026-06-11); v1.2 ha chiuso
SEC-009→SEC-020; **v1.3 (2026-07-04) chiude SEC-021→SEC-028** (2 CVE HIGH di
dipendenze, DoS da parametri, formula injection CSV/Excel, cap cache, rate limit
change-password e un bug di routing analytics). Restano prioritari, invariati:
**SEC-012** (rotazione segreti + riscrittura history, richiede coordinamento team) e
**SEC-014** (bucket Supabase da rendere privato, azione manuale).
