# MaintAI — Security Audit Report

**Data:** 2026-06-09
**Versione report:** 1.0
**Piattaforma:** MaintAI 3.3.1
**Branch:** `claude/intelligent-euler-gfy4us`
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
| SEC-006 | MEDIUM | MFA assente per ruoli privilegiati (NIS2 §2j) | Implementare TOTP obbligatorio per `superadmin`/`responsabile` |
| SEC-007 | MEDIUM | Retention log `SystemLog` non formalizzata a 12 mesi (A.8.15) | Estendere `retention_service` con rotation/retention log + arricchire eventi con `ip`/`user_id` |
| SEC-008 | LOW | Login 20/min, nessun account lockout/alerting | Tightening a 5–10/min su `/auth/login` + alert su soglia di fallimenti |
| SEC-009 | LOW | Password min 8 (con complessità) | Portare il minimo a 12 per allineamento enterprise/NIS2 |
| SEC-010 | LOW | Solo access token 24h, nessun refresh con rotazione | Valutare refresh token rotation (riduce finestra access token) |
| SEC-011 | LOW | RLS PostgreSQL non attiva (accesso solo via backend) | Difesa-in-profondità: abilitare RLS per tenant come secondo livello |

> Nessun elemento del backlog rappresenta una vulnerabilità sfruttabile da remoto allo stato attuale:
> sono irrobustimenti e misure di compliance.

---

## Dependency Scan Results

**Backend (`pip-audit -r backend/requirements.txt`):**
- Pacchetto vulnerabile pre-fix: `pyjwt 2.12.1` (4 vulnerabilità).
- **Post-fix (`pyjwt==2.13.0`): 0 vulnerabilità HIGH/CRITICAL attese** sulla dipendenza corretta.
- Report grezzo: `docs/security/pip_audit_report.json`.

**Frontend (`npm audit`):**
- Pre-fix: 1 HIGH (`next`) + 1 MODERATE (`postcss`).
- Post-fix (`next@16.2.7`): **0 HIGH, 0 CRITICAL**; 2 MODERATE residue (postcss build-time, accettate).
- Report grezzo: `docs/security/npm_audit_report.json`.

---

## SAST Results (`bandit -r backend/ -ll`)

- Issue **HIGH: 0**
- Issue **MEDIUM: 2** — entrambi falsi positivi (SEC-003 `init_db.py:59`, SEC-004 `main.py:115`)
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
| A.8 Technological | 18 | 6 | gap: MFA, retention log, IDS, deletion, pentest |

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
| A07 Auth Failures | rate limit, blacklist JTI, `token_version`, cookie HttpOnly |
| A08 Integrity Failures | upload magic-bytes, dipendenze pinnate |
| A09 Logging Failures | `SystemLog` (retention 12m in backlog) |
| A10 SSRF | chiamate esterne limitate a OpenAI/Open-Meteo lato server |

---

## Stato Sales Readiness

**Punteggio checklist:** 21 ✅ / 9 🔄 / 1 📋 (dettaglio: `docs/security/SALES_READINESS_CHECKLIST.md`)
**Giudizio:** **CONDITIONAL READY** — tecnicamente solido e privo di vulnerabilità HIGH note;
completare i backlog SEC-006…SEC-011 per il pieno READY FOR SALE enterprise/NIS2.

---

## Raccomandazioni Prioritarie (Next Steps)

1. **MFA (SEC-006)** — TOTP obbligatorio per ruoli privilegiati. *Effort: ~16h.*
2. **Retention & arricchimento log (SEC-007)** — rotation/retention 12m su `SystemLog` + `ip`/`user_id`/`result` sugli eventi CRUD critici ed export. *Effort: ~10h.*
3. **DPA template + privacy notice GDPR (cliente-facing)** — chiusura documentale per procurement. *Effort: ~8h.*
4. **Test restore trimestrale + procedura BCP (SEC, §2c)** — documentare e verificare il ripristino backup. *Effort: ~6h.*
5. **Tightening login + alerting brute-force (SEC-008)** e **password min 12 (SEC-009)**. *Effort: ~4h.*

---

## Files Modificati
- `backend/requirements.txt` — `pyjwt==2.12.1` → `pyjwt==2.13.0` (SEC-001)
- `frontend/package.json` + `frontend/package-lock.json` — `next` → `^16.2.7` (SEC-002)

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
