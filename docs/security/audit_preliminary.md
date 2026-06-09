# MaintAI — Audit Preliminare di Sicurezza (FASE 0)

**Data:** 2026-06-09
**Versione piattaforma:** 3.3.1
**Eseguito da:** Claude Code — Security Hardening Routine (ISO 27001/27002 + NIS2)
**Branch:** `claude/intelligent-euler-gfy4us`

> Questo documento è l'analisi preliminare richiesta dalla FASE 0. Fotografa lo
> stato di sicurezza del codice **prima** dei fix applicati nella stessa sessione
> (vedi `SECURITY_AUDIT_REPORT.md` per gli interventi e il giudizio finale).

---

## 1. Inventario asset informatici (ISO 27001 A.5.9)

| Asset | Tecnologia | Hosting | Dati trattati | Criticità |
|---|---|---|---|---|
| Frontend Web | Next.js 16, TypeScript | Vercel | UI, JWT in cookie HttpOnly | Alta |
| Backend API | FastAPI, SQLAlchemy, Pydantic v2 | Render | Logica business, auth, multi-tenant | **Critica** |
| Database primario | PostgreSQL | Supabase | Asset, ticket, utenti, tecnici (PII), tenant | **Critica** |
| Database demo | SQLite (`demo.db`) | Render (ephemeral) | Dati demo isolati | Bassa |
| Object storage | Supabase Storage | Supabase | Allegati ticket, manuali PDF | Media |
| Servizio AI | OpenAI API (`gpt-4.1` / `gpt-4.1-mini`) | OpenAI | Testi diagnostici, contenuto manuali | Media |
| Servizio meteo | Open-Meteo API | Open-Meteo | Coordinate asset (no PII) | Bassa |
| Mailbox IMAP | Provider cliente | esterno | Email→ticket, credenziali IMAP cifrate (Fernet) | Alta |
| Desktop app | Tauri (WebView2) | distribuzione locale | stessa API backend | Media |

### Categorie di dati personali (GDPR)
- **Tecnici**: nome, telefono, sede/indirizzo, assenze, attestati/certificazioni.
- **Utenti**: username, ruolo, hash password (bcrypt), tenant.
- **Email-to-ticket**: mittente e corpo email (possibile PII di terzi).

---

## 2. Mappa delle superfici di attacco

| Superficie | Esposizione | Controllo presente |
|---|---|---|
| `POST /auth/login` | pubblica | rate limit slowapi, bcrypt, log tentativi falliti |
| `POST /auth/change-password`, `PUT /utenti/{id}/password` | autenticata | policy password forte (regex), `token_version` bump |
| 168 route API (33 moduli) | per ruolo/tenant | `Depends(get_current_tenant_id / get_current_user_payload)` su 30/33 file |
| Endpoint pubblici di design | pubblica | `/health`, `/modules`, `/desktop-update`, QR `check_primo_livello` (token a scadenza/revoca) |
| Upload file (allegati, manuali, documenti asset) | autenticata | validazione magic-bytes, MIME whitelist, serving forzato `attachment` |
| Header `X-Tenant-Id` | solo superadmin | impersonificazione tenant ristretta a ruolo `superadmin` |
| Richieste mutanti cross-site | browser | middleware anti-CSRF Origin/Referer **fail-closed** |
| Chiamate OpenAI | server→OpenAI | nessun secret nel client; payload sanitizzati lato servizio |
| Background jobs (email poller, retention, auto-ticket) | interni | gating per modulo, backoff esponenziale su errori IMAP |

---

## 3. Meccanismi di sicurezza già presenti (baseline)

**Autenticazione / Sessione** (`backend/core/security.py`):
- JWT `HS256`, `JWT_SECRET` **obbligatorio** (il server non parte se manca/è vuoto).
- Access token con scadenza configurabile (`ACCESS_TOKEN_EXPIRE_MINUTES`, default 1440 = 24h).
- Revoca immediata via **blacklist JTI** (`RevokedToken`) al logout.
- Invalidazione globale via **`token_version`** (bump al cambio password → invalida tutti i token).
- Controllo `is_active` di utente **e** tenant ad ogni richiesta.
- Token via **cookie HttpOnly** (`Secure` in produzione, `SameSite`), header `Authorization: Bearer` come fallback per client nativi (Tauri).

**Autorizzazione**:
- RBAC con `require_superadmin`, `require_roles(...)`; `superadmin` sempre ammesso.
- Object-level: `check_tenant_ownership()` → 404 (non rivela esistenza cross-tenant).
- Isolamento multi-tenant: `tenant_id` su ogni tabella, `ContextVar current_tenant_id`.

**Crittografia**:
- Password: **bcrypt** (`bcrypt==5.0.0`, salt per-hash).
- At-rest: **Fernet** per le password IMAP (`ENCRYPTION_KEY` obbligatoria e validata all'avvio).
- In-transit: HTTPS forzato (Vercel/Render), HSTS in produzione.

**Hardening trasporto / web**:
- CORS allowlist esplicita (no wildcard), separazione prod/dev, warning se origin privati in prod.
- Middleware anti-CSRF (Origin/Referer, fail-closed sulle richieste mutanti).
- Security headers backend (`X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS) e frontend (CSP, `X-Frame-Options: DENY`, ecc.).
- Rate limiting `slowapi` (key = IP reale dietro Cloudflare/Render).

**Input / Output**:
- ORM SQLAlchemy ovunque; nessuna query con f-string su input utente.
- Validazione Pydantic v2 sugli schemi.
- Upload: validazione magic-bytes + MIME whitelist + serving sicuro anti stored-XSS.

**Audit / Logging**:
- Log persistenti in DB (`SystemLog`) via `log_to_db()/db_info/db_warn/db_error`.
- Eventi di auth (login ok/fail, CSRF) tracciati.

---

## 4. Vulnerabilità e gap rilevati (pre-fix)

| ID | Severity | Categoria | Descrizione |
|---|---|---|---|
| SEC-001 | **HIGH** | Dipendenze (A.8.8) | `pyjwt==2.12.1` con 4 CVE note (PYSEC-2026-175/177/178/179), fix in 2.13.0. Libreria core dell'auth. |
| SEC-002 | **HIGH** | Dipendenze (A.8.8) | `next==16.1.6` con vuln HIGH (request smuggling, CSRF bypass su null origin, DoS, cache poisoning), fix in 16.2.7. |
| SEC-003 | MEDIUM | SAST (falso positivo) | Bandit B608 su `init_db.py:59` — f-string su nome tabella da **lista hardcoded**, valore con bind param. Non sfruttabile. |
| SEC-004 | MEDIUM | SAST (falso positivo) | Bandit B104 su `main.py:115` — `"0.0.0.0"` è una **stringa-hint** per il rilevamento CORS, non un bind di socket. |
| SEC-005 | MEDIUM | Dipendenze (build-time) | `postcss` (transitivo via `next`) — XSS in CSS stringify. Solo build-time su sorgenti fidate; nessun fix forward pulito. |
| SEC-006 | MEDIUM | MFA (NIS2 §2j) | MFA non disponibile/forzato per ruoli ADMIN/MANAGER. |
| SEC-007 | LOW/MEDIUM | Logging retention (A.8.15) | Retention job purga solo ticket soft-deleted (30gg); **nessuna policy formale 12 mesi** per `SystemLog`. |
| SEC-008 | LOW | Brute-force (A.8.16) | Login rate limit 20/min, **nessun account lockout** né alerting su soglia di login falliti. |
| SEC-009 | LOW | Password policy | Lunghezza minima 8 (con complessità). Enterprise/NIS2 suggeriscono ≥12. |
| SEC-010 | LOW | Sessione | Solo access token (24h); nessun meccanismo di **refresh token con rotazione**. |

---

## 5. Gap analysis sintetica vs ISO 27002:2022 / NIS2 Art. 21

| Area | Stato |
|---|---|
| A.5.15–A.5.18 Access control / RBAC / autenticazione | ✅ Implementato |
| A.8.3 Restrizione accessi (multi-tenant) | ✅ Implementato |
| A.8.20 Sicurezza di rete (CORS/headers/TLS) | ✅ Implementato |
| A.8.24 Crittografia | ✅ Implementato (bcrypt, Fernet, TLS) |
| A.8.28 Coding sicuro (ORM, validazione) | ✅ Implementato |
| A.8.8 Gestione vulnerabilità tecniche | 🔄 Da formalizzare processo periodico (fix puntuali fatti) |
| A.8.15–A.8.16 Logging & Monitoring | 🔄 Logging ok; retention 12m e IDS da formalizzare |
| A.5.26 / NIS2 Art.23 Incident response | 🔄 Da documentare (vedi `SECURITY.md`) |
| A.5.29–A.5.30 Business continuity | 🔄 Backup Supabase ok; RPO/RTO + test restore da documentare |
| NIS2 §2j MFA | 🔄 Da implementare per ruoli privilegiati |
| A.5.34 / GDPR privacy & PII | 🔄 Da documentare (sezione GDPR in `SECURITY.md`) |

**Conclusione FASE 0:** la baseline tecnica è solida (auth, multi-tenant, crittografia,
input validation e hardening trasporto già presenti). I gap principali sono (a) 2 dipendenze
con CVE da aggiornare — risolte in questa sessione — e (b) **documentazione di compliance**
e alcune misure organizzative/operative (MFA, retention log, BCP, GDPR) elencate sopra.
