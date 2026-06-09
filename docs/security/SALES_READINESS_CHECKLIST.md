# MaintAI — Sales Readiness Security Checklist

**Data:** 2026-06-09 · **Versione:** 1.0 · **Piattaforma:** MaintAI 3.3.1
**Stato verificato dal codice del branch** `claude/intelligent-euler-gfy4us`.

Legenda: ✅ Conforme · 🔄 Parziale/backlog · ❌ Mancante

## Autenticazione e Accesso
- [✅] JWT con expiry configurato (access 24h via `ACCESS_TOKEN_EXPIRE_MINUTES`)
- [🔄] Refresh token con rotazione — *non presente; solo access token (SEC-010)*
- [✅] Password hashing: **bcrypt** (`bcrypt==5.0.0`)
- [🔄] Password min length ≥12 — *attuale: min 8 + complessità (SEC-009)*
- [✅] Rate limiting su `/auth/login` (slowapi, 20/min) — *tightening a 5–10/min consigliato (SEC-008)*
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
- [✅] Nessun header che espone stack rilevato

## Codice e Dipendenze
- [✅] No SQL injection (SQLAlchemy ORM; nessuna f-string su input utente)
- [✅] Validazione Pydantic sugli input
- [✅] No hardcoded secrets (grep su `sk-`, `postgres://`, `SECRET_KEY=...`: 0 in codice)
- [✅] `.env.example` aggiornato e `.gitignore` corretto (`.env`, `*.key`, `*.pem`, signing key)
- [✅] **pip-audit**: 0 vulnerabilità HIGH/CRITICAL dopo il fix `pyjwt 2.13.0`
- [✅] **bandit**: 0 issue HIGH (2 MEDIUM = falsi positivi documentati)
- [✅] **npm audit**: 0 HIGH/CRITICAL dopo il fix `next 16.2.7` (2 MEDIUM build-time accettati)

## Database
- [📋] RLS PostgreSQL — *l'app accede al DB solo via backend autenticato (no client diretto); RLS difesa-in-profondità consigliata (SEC-011)*
- [✅] Connessione con `sslmode=require` (documentato in `.env.example`/`SECURITY.md`)
- [✅] Backup automatici Supabase (cifrati) — *test restore trimestrale in backlog*
- [✅] Nessuna credenziale DB nel codice

## Logging e Compliance
- [✅] Audit log strutturato attivo (`SystemLog`)
- [🔄] Log retention 12 mesi — *retention attuale solo su ticket soft-deleted (SEC-007)*
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
| ✅ Conforme | 21 |
| 🔄 Parziale/backlog | 9 |
| 📋 / ❌ | 1 |

**Giudizio: CONDITIONAL READY.** Tutti i controlli **tecnici core** di sicurezza sono
in posizione e le vulnerabilità HIGH delle dipendenze sono risolte. Il completamento dei
punti 🔄 (MFA, retention log 12m, DPA/privacy notice, test restore, materiali sales) porta
allo stato **READY FOR SALE** per clienti enterprise/NIS2.
