# MaintAI — Security Audit Report

**Data:** 2026-06-12 (aggiornamento della v1.1 del 2026-06-11)
**Versione report:** 1.2
**Piattaforma:** MaintAI 3.3.1
**Eseguito da:** Claude Code — Automated Security Review (ISO 27001/27002 + NIS2 + OWASP Top 10 2021)

---

## Stato branch e ambito di verifica

> La v1.1 di questo report descriveva la PR #16 (`claude/blissful-rubin-1q23r7`) e **non**
> lo stato di `main` al momento della pubblicazione. La PR #16 è stata **merged su `main`
> il 2026-06-11** (commit `2332c77`). La presente v1.2 ri-esegue **tutte le evidenze su
> `main` post-merge** e sul branch di hardening di questa sessione
> (`claude/tender-bohr-3ecuxk`), che contiene le correzioni aggiuntive elencate sotto.
> Ogni finding indica esplicitamente su quale stato è verificato. Le evidenze vanno
> ri-eseguite dopo il merge di questo branch su `main`.

---

## Executive Summary

MaintAI ha una base tecnica solida: autenticazione JWT con segreto obbligatorio,
blacklist JTI e invalidazione via `token_version`; hashing password bcrypt; isolamento
multi-tenant con `check_tenant_ownership` (404 anti-enumeration); crittografia at-rest
Fernet per le credenziali IMAP; middleware anti-CSRF fail-closed; rate limiting
`slowapi`; security headers su backend e frontend; uso pervasivo dell'ORM SQLAlchemy e
validazione Pydantic.

La revisione critica della v1.1 ha però evidenziato che alcune dichiarazioni erano
**premature o incomplete**. I caveat che questa v1.2 corregge:

- **Segreti nella history git (CRITICO, aperto/parziale)** — la history contiene ancora
  una password PostgreSQL di produzione e token JWT demo (SEC-012). Il file è stato
  rimosso da HEAD, ma **rotazione credenziali e riscrittura della history non sono
  ancora state eseguite**.
- **Upload/storage non uniformemente protetti** — la validazione magic-bytes copriva
  solo i documenti asset; allegati ticket, firme, allegati email e import Excel/PDF
  erano scoperti (SEC-013, chiuso in questa sessione). Gli allegati ticket erano
  serviti via **URL pubblici Supabase** (SEC-014, parziale: serve azione manuale).
- **RBAC ticket incompleto** — le route mutanti dei ticket richiedevano solo
  autenticazione, senza matrice ruoli (SEC-015, chiuso in questa sessione con un gap
  residuo documentato).
- **Password policy non realmente centralizzata** — `tenants.py` manteneva una regex
  locale a minimo 8 caratteri: SEC-009 **non era chiuso** come dichiarato in v1.1
  (chiuso ora).
- **Client desktop Tauri non auditato in profondità** — `csp: null`, capability
  `shell:default`, versione disallineata (SEC-018, chiuso in questa sessione).

**Raccomandazione:** stato **CONDITIONAL READY**. I blocchi residui per il pieno
READY FOR SALE enterprise/NIS2 sono: gestione della secret history (SEC-012, CRITICO),
bucket Supabase da rendere privato (SEC-014, azione manuale), MFA (SEC-006), refresh
rotation (SEC-010), RLS (SEC-011) e gli adempimenti documentali (DPA, privacy notice,
test restore).

### Aggiornamento v1.2 — 2026-06-12 (correzioni da revisione critica)

Interventi applicati in questa sessione (branch `claude/tender-bohr-3ecuxk`):

- **SEC-009 chiuso davvero** — policy password (min 12) importata da
  `core/security.py` anche in `tenants.py` (creazione tenant con admin, creazione
  utente da superadmin, reset da superadmin); `min_length=12` anche nello schema
  Pydantic. 19 test nuovi coprono il rifiuto di password 8–11 caratteri su **tutti**
  i percorsi.
- **SEC-013 chiuso** — `validate_upload()` (magic-bytes + anti-HTML per csv/txt +
  blocco estensioni vuote) applicata a: allegati ticket, firma base64 (verifica PNG
  reale), allegati email IMAP, bulk import Excel, import PDF/Excel piani manutenzione.
- **SEC-014 parziale** — `storage.save_file()` non restituisce più URL pubblici;
  nuovi endpoint autenticati e tenant-filtrati `GET /tickets/allegati/{id}/download`
  e `GET /tickets/{id}/firma` con `nosniff` e `Content-Disposition` sicuro;
  retro-compatibilità con i percorsi legacy. **Resta manuale**: rendere privato il
  bucket Supabase `maintai-uploads` dalla dashboard.
- **SEC-015 chiuso (con gap residuo)** — matrice ruoli sui ticket: bulk update,
  eliminazione, campi di pianificazione/assegnazione e sync gerarchia riservati a
  responsabile/superadmin; il tecnico mantiene esecuzione, chiusura, allegati, firma
  e creazione da campo. 13 test RBAC ticket nuovi.
- **SEC-016 chiuso** — `_load_origins()` ora fail-closed: startup abort su wildcard
  `*` (sempre) e su origin privati in produzione.
- **SEC-017 chiuso/documentato** — header proxy (`CF-Connecting-IP`,
  `X-Forwarded-For`) onorati solo con `TRUST_PROXY_HEADERS` attivo; documentato il
  limite per-worker dei contatori in-memory di slowapi.
- **SEC-018 chiuso** — Tauri: CSP definita (non più `null`), plugin/capability
  `shell` rimossi (nessun uso nel codice), versione desktop allineata a 3.3.1,
  sezione sicurezza desktop in `DESKTOP.md`, test di regressione sulla config.
- **SEC-019 chiuso** — il JWT nel body del login viene restituito **solo ai client
  desktop** (Origin Tauri o header `X-Client: desktop`); per il web il token vive
  esclusivamente nel cookie HttpOnly. Rischio localStorage desktop documentato.
- **SEC-020 chiuso** — redaction centralizzata in `logger_db.py`: chiavi sensibili
  (`password`, `token`, `authorization`, `cookie`, `raw`, `prompt`, …) oscurate,
  pattern di segreti (JWT, API key, URL con credenziali) redatti, extra lunghi
  troncati a 4000 caratteri.
- **CI estesa** — nuovi workflow `ci.yml` (pytest, npm build, npm lint, Semgrep
  OWASP) e `codeql.yml` (Python + TypeScript), in aggiunta a gitleaks/pip-audit/
  npm-audit già presenti in `security.yml`.

Suite test backend: **157 passed** (93 in v1.1 → +64 nuovi test di sicurezza).

---

## Registro Finding

| ID | Severity | Categoria | Descrizione | Status |
|---|---|---|---|---|
| SEC-001 | HIGH | Dipendenze (A.8.8) | `pyjwt==2.12.1`: 4 CVE | ✅ Risolto **su `main`** (pyjwt 2.13.0, ri-verificato con pip-audit 2026-06-12) |
| SEC-002 | HIGH | Dipendenze (A.8.8) | `next==16.1.6`: request smuggling, CSRF bypass, DoS, XSS | ✅ Risolto **su `main`** (next 16.2.7, npm audit high pulito 2026-06-12) |
| SEC-003 | MEDIUM | SAST | Bandit B608 `init_db.py` — f-string su nome tabella | ✅ Accepted (falso positivo: nome da lista hardcoded, bind param) |
| SEC-004 | MEDIUM | SAST | Bandit B104 `main.py` — bind a tutte le interfacce | ✅ Accepted (falso positivo: stringa-hint CORS, non bind socket) |
| SEC-005 | MEDIUM | Dipendenze (build) | `postcss` transitivo via `next` (2 MODERATE) | ⚠️ Accepted Risk (solo build-time; unico fix proposto da npm è downgrade a next@9) |
| SEC-006 | MEDIUM | Auth (NIS2 §2j) | MFA assente per ruoli privilegiati | **Aperto.** TOTP per superadmin/responsabile in roadmap |
| SEC-007 | MEDIUM | Logging (A.8.15) | Retention log non formalizzata | ✅ Chiuso (merged su `main` con PR #16: `cleanup_old_system_logs` min 365gg + pulizia blacklist JTI scaduta) |
| SEC-008 | LOW | Auth | Login 20/min, nessun alerting brute-force | ✅ Chiuso (merged su `main` con PR #16: 5/min + `security_monitor`); v1.2 aggiunge `TRUST_PROXY_HEADERS` (SEC-017) |
| SEC-009 | LOW | Auth | Password min 8 | ✅ **Chiuso in v1.2.** La v1.1 lo dichiarava chiuso ma `tenants.py` restava a min 8 con regex locale; ora policy unica in `core/security.py` + test su tutti i percorsi |
| SEC-010 | LOW | Auth | Nessun refresh token con rotazione | **Aperto (accepted risk).** Mitigato da blacklist JTI + `token_version` |
| SEC-011 | LOW | DB | RLS PostgreSQL non attiva | **Aperto.** Difesa in profondità in roadmap |
| SEC-012 | **CRITICAL** | Segreti (A.5.17) | **Segreti nella history git**: `.claude/settings.local.json` presente in 2 commit storici (`de37f8c` introduzione, `01a8b88` rimozione) contiene la **password PostgreSQL del pooler Supabase di produzione**, token JWT demo (scaduti) e il riferimento alla generazione della chiave di firma Tauri | 🔴 **Aperto/parziale.** File rimosso da HEAD, ma: (1) credenziali DB **da ruotare**, (2) history **da riscrivere** con `git-filter-repo`/BFG, (3) force-push e re-clone dei workspace **da coordinare**. Vedi piano di remediation sotto |
| SEC-013 | HIGH | Upload (A.8.23) | Magic-bytes assenti su allegati ticket (estensione vuota bypassava il check), firme base64 (PNG mai verificato), allegati email, bulk import Excel, import PDF/Excel piani | ✅ **Chiuso in v1.2** — `validate_upload()` esteso a tutti i percorsi + 14 test (HTML mascherato da .png/.pdf, firma non-PNG, xlsx fasullo) |
| SEC-014 | HIGH | Storage (A.8.12) | Allegati ticket serviti via **URL pubblico Supabase** / mount `/uploads` locale, senza auth né check tenant | 🟡 **Parziale in v1.2** — codice corretto (path interni + endpoint autenticati `nosniff`); **resta manuale** rendere privato il bucket Supabase; i file legacy restano raggiungibili via URL finché il bucket è pubblico |
| SEC-015 | MEDIUM | RBAC (A.5.15) | Route ticket mutanti senza matrice ruoli (bulk update, eliminazione, pianificazione, sync gerarchia aperte ai tecnici) | ✅ **Chiuso in v1.2** con matrice ruoli + 13 test. Gap residuo documentato: ownership per-tecnico (un tecnico può aggiornare l'esecuzione di ticket non propri — manca il mapping Utente→Tecnico nel modello dati) |
| SEC-016 | MEDIUM | CORS (A.8.9) | Origin privati/wildcard in produzione solo loggati, non bloccati | ✅ **Chiuso in v1.2** — startup abort fail-closed + 10 test su `_load_origins()` |
| SEC-017 | MEDIUM | Rate limiting | `CF-Connecting-IP`/`X-Forwarded-For` fidati incondizionatamente (spoofabili senza proxy); contatori in-memory per-worker non documentati | ✅ **Chiuso/documentato in v1.2** — `TRUST_PROXY_HEADERS` (default attivo: Render sanifica XFF); limite per-worker documentato (deploy attuale: 1 worker; per scalare serve storage Redis) |
| SEC-018 | MEDIUM | Desktop Tauri | `csp: null`, capability `shell:default` inutilizzata, versione desktop 3.1.6 ≠ 3.3.1 | ✅ **Chiuso in v1.2** — CSP definita, plugin shell rimosso (Rust + capability), versione allineata, test di regressione. La chiave privata di firma updater **non risulta mai tracciata nel repo** (verificato su tutta la history); va custodita fuori repo con password non vuota |
| SEC-019 | LOW | Auth | JWT restituito nel body JSON del login a **tutti** i client (incluso web, che usa il cookie HttpOnly) | ✅ **Chiuso in v1.2** — token nel body solo per client desktop (Origin Tauri / `X-Client: desktop`); rischio localStorage desktop documentato in `DESKTOP.md`. Non scrivere più "JWT solo cookie HttpOnly": vale per il web, non per il desktop |
| SEC-020 | LOW | Logging/Privacy | `SystemLog.extra_info` senza redaction; possibili snippet raw AI nei log | ✅ **Chiuso in v1.2** — redaction centralizzata + troncamento + 5 test |

> ⚠️ A differenza della v1.1, **non tutti gli elementi aperti sono "solo hardening"**:
> SEC-012 (segreti nella history) è una vulnerabilità reale finché le credenziali non
> vengono ruotate, e SEC-014 lascia i file legacy esposti finché il bucket non è privato.

---

## SEC-012 — Piano di remediation segreti nella history (CRITICO)

Verifica eseguita il 2026-06-12 su tutta la history (`git log --all`):
`.claude/settings.local.json` compare in **2 commit** (la segnalazione iniziale
indicava 18; il numero verificato su questo repository è 2 — l'esposizione resta
critica a prescindere dal conteggio). Contenuti sensibili confermati:

1. **Password DB di produzione** nel DSN `postgresql://postgres.***:***@aws-1-eu-west-1.pooler.supabase.com` — **da ruotare subito** (Supabase Dashboard → Settings → Database → Reset password, poi aggiornare `DATABASE_URL` su Render).
2. Token JWT demo firmati (scaduti ad aprile 2026 — rischio residuo nullo dopo verifica `exp`).
3. `JWT_SECRET`/`ENCRYPTION_KEY` di test (valori fittizi, usati anche in CI — non sono segreti di produzione).
4. Comando di generazione della chiave di firma Tauri con `TAURI_KEY_PASSWORD=""` (chiave generata **fuori** dal repo; mai committata — verificato).

Passi rimanenti (richiedono coordinamento del team, **non eseguibili in automatico**):

1. Ruotare la password PostgreSQL Supabase e ogni credenziale collegata.
2. Riscrivere la history: `git filter-repo --invert-paths --path .claude/settings.local.json` (o BFG).
3. Force-push coordinato di `main` e dei branch attivi; re-clone di tutti i workspace.
4. Invalidare eventuali fork/cloni CI che conservano la history precedente.
5. Solo dopo: marcare SEC-012 come chiuso e ri-eseguire gitleaks su tutta la history.

---

## Evidenze scan (ri-eseguite 2026-06-12)

### Su `main` post-merge PR #16 (commit `5d4b874`)

| Verifica | Esito |
|---|---|
| `pytest backend/tests/` | ✅ **93 passed** |
| `npm run build` | ✅ passed |
| `npm run lint` | ✅ exit 0 — **0 errori, 67 warning** (il "gate ESLint 0 errori" va letto così: il gate blocca gli errori, i warning restano e vanno ridotti progressivamente) |
| `pip-audit -r backend/requirements.txt` | ✅ **0 vulnerabilità** (`pyjwt 2.13.0`) |
| `npm audit --omit=dev --audit-level=high` | ✅ passed — 0 HIGH/CRITICAL; **2 MODERATE** residue (`postcss` transitivo via `next@16.2.7`, accepted risk SEC-005) |
| `bandit -r backend/ -ll` | ✅ 0 HIGH, 2 MEDIUM (falsi positivi SEC-003/004), 330 LOW informativi |

Nota storica: prima del merge della PR #16 su `main` il rate limit login era 20/min e
mancavano `security_monitor`, retention log e `--no-server-header`; le dichiarazioni
della v1.1 erano verificate **solo sulla PR**. Con il merge del 2026-06-11 sono ora
effettive su `main`.

### Sul branch di hardening v1.2 (`claude/tender-bohr-3ecuxk`)

| Verifica | Esito |
|---|---|
| `pytest backend/tests/` | ✅ **157 passed** (+64 test sicurezza: password policy, RBAC ticket, upload, CORS, redaction, Tauri config) |
| `npm run build` | ✅ passed (verificato dopo le modifiche frontend allegati) |
| `pip-audit` / `npm audit` / `bandit` | ✅ invariati rispetto a `main` (report JSON rigenerati in `docs/security/`) |

Report grezzi aggiornati: `docs/security/pip_audit_report.json`,
`docs/security/npm_audit_report.json`, `docs/security/bandit_report.json`.

---

## Verifiche manuali significative

- **SQL injection:** unico match `init_db.py` (nome tabella da lista fissa, bind param). ✅
- **Secret hardcoded in HEAD:** solo placeholder in `.env.example`. ✅ — ma vedi SEC-012 per la **history**.
- **Copertura auth route:** 30/33 file route con dependency di auth; `health`, `desktop_update`, `modules` pubblici per design. ✅
- **CORS:** allowlist esplicita, fail-closed su wildcard e origin privati in produzione (v1.2). ✅
- **Upload:** `validate_upload()` su tutti i percorsi di upload (v1.2); serving con `nosniff` e `Content-Disposition` forzato. ✅
- **Allegati:** download solo via endpoint autenticati tenant-filtrati (v1.2); bucket privato da completare (SEC-014). 🟡

---

## CI/CD e riproducibilità

| Workflow | Contenuto | Stato |
|---|---|---|
| `security.yml` | gitleaks (history completa), pip-audit, npm audit high | ✅ esistente |
| `ci.yml` | pytest backend, npm build, npm lint, **Semgrep** (`p/owasp-top-ten` + `p/security-audit`) | ✅ **nuovo in v1.2** |
| `codeql.yml` | CodeQL Python + TypeScript, `security-and-quality`, run settimanale | ✅ **nuovo in v1.2** |

I report JSON degli scan sono versionati in `docs/security/` e rigenerati a ogni audit.

---

## Compliance Gap Analysis (sintesi)

### ISO/IEC 27001:2022 — Annex A
Controlli tecnici core coperti; gap principali: **A.5.17** (gestione segreti — SEC-012
declassa la valutazione finché la history non è bonificata), A.8.2/MFA (SEC-006),
classificazione informazioni, BCP, training. Dettaglio: `docs/security/ISO27001_CONTROLS_MAPPING.md`.

### NIS2 Art. 21 §2
| Misura | Status | | Misura | Status |
|---|---|---|---|---|
| §2a Policy | ✅ | | §2f Efficacia (KPI) | 🔄 |
| §2b Incident mgmt | ✅ | | §2g Igiene & formazione | 🔄 |
| §2c Business continuity | 🔄 | | §2h Crittografia | ✅ |
| §2d Supply chain | ✅ | | §2i HR/accessi/asset | 🔄 (SEC-012) |
| §2e Secure development | ✅ | | §2j MFA | 🔄 |

### OWASP Top 10 2021 (delta v1.2)
- **A01 Broken Access Control**: ora include matrice ruoli ticket (SEC-015) e download allegati autenticati (SEC-014).
- **A05 Security Misconfiguration**: CORS fail-closed, CSP Tauri, no `Server` header.
- **A07 Auth Failures**: la dicitura corretta è "JWT in cookie HttpOnly per il web; token nel body solo per client desktop Tauri (rischio documentato)".
- **A09 Logging Failures**: redaction centralizzata + retention 12m + alert brute-force.

---

## Stato Sales Readiness

**Giudizio: CONDITIONAL READY.** Blocchi prima del READY FOR SALE enterprise/NIS2,
in ordine di priorità:

1. **SEC-012** — rotazione segreti + riscrittura history (CRITICO, richiede coordinamento team). *Effort: ~4h + comunicazione.*
2. **SEC-014** — bucket Supabase privato (manuale, 10 minuti) + verifica file legacy.
3. **SEC-006** — MFA TOTP per ruoli privilegiati. *Effort: ~16h.*
4. DPA template + privacy notice GDPR. *Effort: ~8h.*
5. Test restore trimestrale + BCP (§2c). *Effort: ~6h.*
6. SEC-010 refresh rotation, SEC-011 RLS, riduzione warning ESLint (67), ownership per-tecnico sui ticket.

---

## Files modificati in questa sessione (v1.2)

**Backend**
- `backend/api/routes/tenants.py` — policy password importata da `core/security.py` (SEC-009)
- `backend/schemas/tenant.py` — `admin_password` min 12 (SEC-009)
- `backend/core/file_validation.py` — firme GIF/WEBP/ZIP/OLE2/MP4 + `validate_upload()` (SEC-013)
- `backend/api/routes/tickets.py` — validazione upload, firma PNG, endpoint download autenticati, matrice ruoli RBAC (SEC-013/014/015)
- `backend/services/email_poller.py` — validazione magic-bytes allegati email (SEC-013)
- `backend/api/routes/bulk_import.py`, `backend/api/routes/piano_manutenzione.py` — magic-bytes su import (SEC-013)
- `backend/core/storage.py` — path interni, `read_file()` con guardia path-traversal, doc bucket privato (SEC-014)
- `backend/main.py` — CORS fail-closed (SEC-016), header `X-Client` in allowlist
- `backend/core/rate_limiter.py` — `TRUST_PROXY_HEADERS` + doc limite per-worker (SEC-017)
- `backend/core/logger_db.py` — redaction centralizzata + troncamento (SEC-020)
- `backend/api/routes/auth.py` — token nel body solo per client desktop (SEC-019)

**Frontend / Desktop**
- `frontend/app/components/UploadAllegati.tsx` — download autenticato via blob (SEC-014)
- `frontend/app/login/page.tsx` — header `X-Client: desktop` per Tauri (SEC-019)
- `frontend/src-tauri/tauri.conf.json` — CSP definita, versione 3.3.1 (SEC-018)
- `frontend/src-tauri/capabilities/default.json`, `src/lib.rs`, `Cargo.toml` — rimosso plugin shell (SEC-018)
- `DESKTOP.md` — sezione sicurezza client desktop (SEC-018/019)

**Test (+64)**
- `backend/tests/test_password_policy.py` (19), `test_rbac_tickets.py` (13),
  `test_upload_security.py` (14), `test_cors_origins.py` (10),
  `test_log_redaction.py` (5), `test_tauri_config.py` (3)

**CI**
- `.github/workflows/ci.yml` (pytest, build, lint, Semgrep) — nuovo
- `.github/workflows/codeql.yml` (CodeQL Python+TS) — nuovo

**Documentazione**
- `docs/security/SECURITY_AUDIT_REPORT.md` (questo file, v1.2)
- `docs/security/{bandit,pip_audit,npm_audit}_report.json` — rigenerati 2026-06-12
