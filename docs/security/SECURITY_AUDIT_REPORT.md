# MaintAI — Security Audit Report

**Data:** 2026-06-11 (aggiornamento della v1.0 del 2026-06-09)
**Versione report:** 1.1
**Piattaforma:** MaintAI 3.3.1
**Branch:** `claude/blissful-rubin-1q23r7`
**Eseguito da:** Claude Code — Automated Security Review (ISO 27001/27002 + NIS2 + OWASP Top 10 2021)

---

## Executive Summary

MaintAI parte da una **postura di sicurezza tecnica già matura**: autenticazione JWT con
segreto obbligatorio, blacklist JTI e invalidazione via `token_version`; hashing password
bcrypt con policy di complessità; isolamento multi-tenant con `check_tenant_ownership`
(404 anti-enumeration); crittografia at-rest Fernet per le credenziali IMAP; middleware
anti-CSRF fail-closed; CORS allowlist senza wildcard; rate limiting `slowapi`; security
headers su backend e frontend (CSP); validazione magic-bytes degli upload; uso pervasivo
dell'ORM SQLAlchemy (nessuna SQL injection rilevata) e validazione Pydantic.

L'audit ha individuato **2 vulnerabilità HIGH nelle dipendenze**, entrambe **risolte** in
questa sessione (aggiornamento `pyjwt` e `next`). La SAST (`bandit`) non ha prodotto issue
HIGH (solo 2 MEDIUM, entrambi falsi positivi documentati). I gap residui sono
prevalentemente **organizzativi/operativi e di documentazione di compliance** (MFA,
retention log a 12 mesi, BCP/test restore, DPA/GDPR notice, materiali sales), ora tracciati
e in larga parte coperti dalla documentazione prodotta.

**Raccomandazione:** stato **CONDITIONAL READY** per la vendita enterprise; chiusura dei
backlog SEC-006…SEC-011 per il pieno **READY FOR SALE** verso clienti soggetti a NIS2.

### Aggiornamento v1.1 — 2026-06-11 (ri-esecuzione routine)

Tutti gli scan sono stati ri-eseguiti: **pip-audit 0 vulnerabilità** (su tutte le
dipendenze, non solo quelle corrette), **bandit 0 HIGH** (stessi 2 MEDIUM falsi
positivi), **npm audit 0 HIGH/CRITICAL** (2 MODERATE build-time già accettate).
Nessuna nuova vulnerabilità nelle dipendenze rispetto alla v1.0.

In questa sessione sono stati **chiusi 3 elementi del backlog**:
- **SEC-007** — retention log di sicurezza a 12 mesi enforced dal codice
  (`cleanup_old_system_logs`, minimo 365 giorni non riducibile via env) + pulizia
  blacklist JTI scaduta + indirizzo IP reale nei log di login.
- **SEC-008** — rate limit `/auth/login` da 20/min a **5/min per IP** + nuovo
  `security_monitor` con alert persistenti su brute-force (≥10 login falliti/utente
  o ≥30/IP in 5 minuti).
- **SEC-009** — password policy portata a **minimo 12 caratteri** e centralizzata
  in `backend/core/security.py` (prima duplicata in 2 route).

Hardening aggiuntivo: rimosso l'header `Server: uvicorn` in produzione
(`--no-server-header` in `render.yaml`). Suite di test backend: **93/93 passed**.

---

## Vulnerabilità Trovate e Risolte

| ID | Severity | Categoria | Descrizione | Status | Fix applicato |
|---|---|---|---|---|---|
| SEC-001 | **HIGH** | Dipendenze (A.8.8) | `pyjwt==2.12.1`: 4 CVE (PYSEC-2026-175/177/178/179), libreria core auth | ✅ Fixed | `backend/requirements.txt` → `pyjwt==2.13.0` |
| SEC-002 | **HIGH** | Dipendenze (A.8.8) | `next==16.1.6`: request smuggling, CSRF bypass null-origin, DoS, cache poisoning, XSS CSP-nonce | ✅ Fixed | `frontend`: `next` → `16.2.7` (minor, stesso major, non-breaking) |
| SEC-003 | MEDIUM | SAST | Bandit B608 `init_db.py:59` — f-string su nome tabella | ✅ Accepted (falso positivo) | Nome da **lista hardcoded**, valore con bind param. Non sfruttabile |
| SEC-004 | MEDIUM | SAST | Bandit B104 `main.py:115` — bind a tutte le interfacce | ✅ Accepted (falso positivo) | `"0.0.0.0"` è **stringa-hint** per filtro CORS, non un bind socket |
| SEC-005 | MEDIUM | Dipendenze (build) | `postcss` transitivo via `next` — XSS in CSS stringify | ⚠️ Accepted Risk | Solo build-time su CSS sorgente fidato; npm propone solo downgrade incoerente (next@9). Monitorato |

---

## Vulnerabilità Non Risolte / Backlog (gap di hardening, non exploit attivi)

| ID | Severity | Descrizione | Motivazione / Azione |
|---|---|---|---|
| SEC-006 | MEDIUM | MFA assente per ruoli privilegiati (NIS2 §2j) | **Aperto.** Implementare TOTP obbligatorio per `superadmin`/`responsabile` |
| SEC-007 | MEDIUM | Retention log `SystemLog` non formalizzata a 12 mesi (A.8.15) | ✅ **Chiuso 2026-06-11** — `cleanup_old_system_logs` (min 365gg) + IP nei log login |
| SEC-008 | LOW | Login 20/min, nessun account lockout/alerting | ✅ **Chiuso 2026-06-11** — limit 5/min + `security_monitor` con alert brute-force |
| SEC-009 | LOW | Password min 8 (con complessità) | ✅ **Chiuso 2026-06-11** — minimo 12, policy centralizzata in `core/security.py` |
| SEC-010 | LOW | Solo access token 24h, nessun refresh con rotazione | **Aperto (accepted risk).** Mitigato da blacklist JTI + `token_version`; refresh rotation in roadmap |
| SEC-011 | LOW | RLS PostgreSQL non attiva (accesso solo via backend) | **Aperto.** Difesa-in-profondità: abilitare RLS per tenant come secondo livello |

> Nessun elemento del backlog rappresenta una vulnerabilità sfruttabile da remoto allo stato attuale:
> sono irrobustimenti e misure di compliance.

---

## Dependency Scan Results

**Backend (`pip-audit -r requirements.txt`, ri-eseguito 2026-06-11):**
- **0 vulnerabilità note** su tutte le dipendenze pinnate (`pyjwt 2.13.0` confermato pulito).
- Report grezzo: `docs/security/pip_audit_report.json`.

**Frontend (`npm audit`, ri-eseguito 2026-06-11, 761 pacchetti):**
- **0 HIGH, 0 CRITICAL, 0 LOW**; 2 MODERATE residue (`postcss` transitivo via `next@16.2.7`,
  solo build-time su CSS sorgente fidato — accepted risk SEC-005, l'unico "fix" proposto
  da npm è un downgrade incoerente a `next@9`).
- Report grezzo: `docs/security/npm_audit_report.json`.

---

## SAST Results (`bandit -r backend/ -ll`)

- Ri-eseguito 2026-06-11 su 18.578 LOC.
- Issue **HIGH: 0**
- Issue **MEDIUM: 2** — entrambi falsi positivi già documentati (SEC-003 `init_db.py:59`, SEC-004 `main.py:115`)
- Issue LOW: 279 (prevalentemente `try/except/pass` e import — informativi)
- Report grezzo: `docs/security/bandit_report.json`

---

## Verifiche manuali significative

- **SQL injection:** ricerca `f"SELECT/INSERT/UPDATE/DELETE"`, `execute(f`, `text(f` → unico match `init_db.py:59` (nome tabella da lista fissa, bind param). ✅
- **Secret hardcoded:** ricerca `sk-…`, `postgres://…:…@`, `SECRET_KEY=`, password literal → solo placeholder in `.env.example`. ✅
- **Copertura auth route:** 30/33 file route usano dependency di auth; i 3 senza (`health`, `desktop_update`, `modules`) sono **pubblici per design**. ✅
- **CORS:** allowlist esplicita, nessun `*`; warning automatico se origin privati in produzione. ✅
- **Upload:** `validate_magic()` (magic-bytes + MIME whitelist) e `safe_serving()` (forza `attachment`, anti stored-XSS). ✅

---

## Compliance Gap Analysis

### ISO/IEC 27001:2022 — Annex A (riepilogo)
| Categoria | ✅ | 🔄 | Note |
|---|---|---|---|
| A.5 Organizational | 11 | 9 | gap: classificazione info, BCP, training |
| A.6 People | 1 | 2 | awareness/training |
| A.7 Physical | 2 | 0 | delegati a provider certificati |
| A.8 Technological | 20 | 4 | gap: MFA, deletion schedulata completa, pentest (retention log e IDS chiusi in v1.1) |

Dettaglio: `docs/security/ISO27001_CONTROLS_MAPPING.md`. **Controlli tecnici core tutti ✅.**

### NIS2 Art. 21 §2
| Misura | Status | | Misura | Status |
|---|---|---|---|---|
| §2a Policy | ✅ | | §2f Efficacia (KPI) | 🔄 |
| §2b Incident mgmt | ✅ | | §2g Igiene & formazione | 🔄 |
| §2c Business continuity | 🔄 | | §2h Crittografia | ✅ |
| §2d Supply chain | ✅ | | §2i HR/accessi/asset | ✅ |
| §2e Secure development | ✅ | | §2j MFA | 🔄 |

Dettaglio: `docs/security/NIS2_COMPLIANCE.md`.

### OWASP Top 10 2021
| Rischio | Mitigazione MaintAI |
|---|---|
| A01 Broken Access Control | RBAC + tenant isolation + `check_tenant_ownership` (404) |
| A02 Cryptographic Failures | bcrypt, Fernet, TLS 1.2+, HSTS |
| A03 Injection | ORM SQLAlchemy, Pydantic, no f-string SQL su input |
| A04 Insecure Design | architettura a layer, fail-closed CSRF |
| A05 Security Misconfiguration | CORS allowlist, security headers, `.env` obbligatorie |
| A06 Vulnerable Components | pip-audit/npm audit; fix pyjwt & next |
| A07 Auth Failures | rate limit 5/min su login, password min 12, blacklist JTI, `token_version`, cookie HttpOnly, alerting brute-force |
| A08 Integrity Failures | upload magic-bytes, dipendenze pinnate |
| A09 Logging Failures | `SystemLog` con retention 12m enforced + alert brute-force (`security_monitor`) |
| A10 SSRF | chiamate esterne limitate a OpenAI/Open-Meteo lato server |

---

## Stato Sales Readiness

**Punteggio checklist (v1.1):** 24 ✅ / 6 🔄 / 1 📋 (dettaglio: `docs/security/SALES_READINESS_CHECKLIST.md`)
**Giudizio:** **CONDITIONAL READY** — tecnicamente solido e privo di vulnerabilità HIGH note;
i gap residui per il pieno READY FOR SALE enterprise/NIS2 sono SEC-006 (MFA),
SEC-010 (refresh rotation), SEC-011 (RLS) e gli adempimenti documentali (DPA,
privacy notice, test restore, materiali sales).

---

## Raccomandazioni Prioritarie (Next Steps)

1. **MFA (SEC-006)** — TOTP obbligatorio per ruoli privilegiati. *Effort: ~16h.*
2. **DPA template + privacy notice GDPR (cliente-facing)** — chiusura documentale per procurement. *Effort: ~8h.*
3. **Test restore trimestrale + procedura BCP (§2c)** — documentare e verificare il ripristino backup. *Effort: ~6h.*
4. **Arricchimento audit log** — `ip`/`user_id`/`result` sugli eventi CRUD critici ed export dati. *Effort: ~6h.*
5. **RLS PostgreSQL (SEC-011)** e **refresh token rotation (SEC-010)** — difesa in profondità. *Effort: ~12h.*

*(Chiusi rispetto alla v1.0: SEC-007 retention log, SEC-008 alerting+rate limit, SEC-009 password 12.)*

---

## Files Modificati

**Sessione v1.0 (2026-06-09):**
- `backend/requirements.txt` — `pyjwt==2.12.1` → `pyjwt==2.13.0` (SEC-001)
- `frontend/package.json` + `frontend/package-lock.json` — `next` → `^16.2.7` (SEC-002)

**Sessione v1.1 (2026-06-11):**
- `backend/core/security.py` — password policy centralizzata (`STRONG_PWD_REGEX` min 12, `PASSWORD_POLICY_MESSAGE`) (SEC-009)
- `backend/api/routes/auth.py` — rate limit login 5/min, IP nei log, hook `security_monitor`, policy importata (SEC-008/007/009)
- `backend/api/routes/utenti.py` — policy password importata da `core/security.py` (SEC-009)
- `backend/services/security_monitor.py` — **nuovo**: alert brute-force su SystemLog (SEC-008)
- `backend/services/retention_service.py` — `cleanup_old_system_logs` (retention 12m) + `cleanup_expired_revoked_tokens` (SEC-007)
- `render.yaml` — `--no-server-header` (anti-fingerprinting)
- `backend/.env.example` — documentata `LOG_RETENTION_DAYS`
- `SECURITY.md`, `docs/security/*.md` — aggiornamento compliance a v1.1
- `docs/security/{bandit,pip_audit,npm_audit}_report.json` — report rigenerati

## Files di Documentazione Creati
- `SECURITY.md`
- `docs/security/audit_preliminary.md`
- `docs/security/ISO27001_CONTROLS_MAPPING.md`
- `docs/security/NIS2_COMPLIANCE.md`
- `docs/security/SALES_READINESS_CHECKLIST.md`
- `docs/security/SECURITY_AUDIT_REPORT.md` (questo file)
- `docs/security/bandit_report.json`
- `docs/security/pip_audit_report.json`
- `docs/security/npm_audit_report.json`
