# MaintAI — Audit di Sicurezza & Stabilità (Report Finale per stato vendibile)

**Data:** 2026-06-08
**Versione auditata → rilasciata:** `3.3.1` → **`3.3.2`**
**Metodologia:** lettura diretta del codice + OWASP Top 10:2021, OWASP API Security Top 10:2023, OWASP ASVS, OWASP Top 10 LLM, e mappatura **ISO/IEC 27001:2022 / 27002:2022 / NIS2** (vedi `COMPLIANCE_ISO27001_27002_NIS2.md`).
**Scope:** backend FastAPI, frontend Next.js, isolamento multi-tenant, background job, file upload, AI/LLM, supply chain, configurazione cloud.
**Esito test:** **93/93 backend test verdi** · **`pip-audit` = 0 vulnerabilità** dopo remediation.

> Report finale successivo a [`SECURITY_AUDIT_2026-05-30.md`](SECURITY_AUDIT_2026-05-30.md) (19 finding SEC-01→19, 14 risolti).
> Questo ciclo ha individuato **24 finding** aggiuntivi e ne ha **risolti 21 nel codice**; restano 1 Critico (azione manuale) e 2 di roadmap.

---

## 1. Executive Summary

Postura di sicurezza **solida e production-ready** per la vendita, con due caveat noti e tracciati.
Le fondamenta sono robuste: isolamento multi-tenant a livello ORM (`with_loader_criteria` + `check_tenant_ownership`),
autenticazione JWT con revoca (blacklist `jti` + `token_version`), cifratura at-rest Fernet, anti-CSRF fail-closed,
security headers su backend e frontend, CORS allowlist, rate limiting, validazione magic-bytes, SSRF prevention su IMAP.

In questo ciclo sono stati corretti tutti i finding **Alti** (DoS input, magic-bytes allegati, leak di errori 500),
quasi tutti i **Medi** (rate limit, timeout esterni, bound input, cleanup blacklist, filtro tenant esplicito) e la
maggior parte dei **Bassi** (deps deprecate, logging, validazione cookie). È stata inoltre risolta una **vulnerabilità
reale di supply chain**: `PyJWT 2.12.1` (4 CVE) → `2.13.0`, e migrata la libreria PDF deprecata a `pypdf 6.13.1` (ultima sicura).

### Distribuzione finding (questo ciclo)

| Gravità | Tot | Risolti nel codice | Manuale/Roadmap |
|---|---|---|---|
| 🔴 Critica | 1 | — | 1 (CONF-01: rotazione segreto + scrub history) |
| 🟠 Alta | 3 | 3 | — |
| 🟡 Media | 8 | 8 | — |
| 🟢 Bassa | 12 | 10 | 2 (MFA → roadmap; CSP nonce → roadmap) |
| **Totale** | **24** | **21** | **3** |

---

## 2. Finding e remediation

### 🔴 Critica

| ID | Titolo | Stato | Azione |
|---|---|---|---|
| **CONF-01** | Segreto DB di produzione nella history git (ereditato SEC-01) | 🟡 Manuale | Ruotare password Supabase + `JWT_SECRET`/`ENCRYPTION_KEY`, `git filter-repo` + force-push. Vedi §4. |

### 🟠 Alta — tutte risolte

| ID | Titolo | File | Fix |
|---|---|---|---|
| **VAL-01** | `GeneratePlanRequest.days` senza limiti → DoS AI/costi OpenAI | `planning.py` | `Field(ge=1, le=90)`, `mode` con `pattern`, `asset_ids` `max_length=1000` |
| **UPLOAD-01** | Allegati ticket: solo estensione, nessun magic-bytes → stored XSS | `tickets.py` | `validate_magic()` sui tipi noti; `tipo_mime` da `safe_serving()` (whitelist server-side, non dal client) |
| **ERR-01** | Eccezioni 500 con dettagli interni esposti al client | `planning.py`, `asset_documenti.py`, `assets.py` | Messaggi generici al client; dettagli solo nei log server-side |

### 🟡 Media — tutte risolte

| ID | Titolo | File | Fix |
|---|---|---|---|
| **MT-01** | `_batch_completion_pct`: query ticket senza filtro tenant esplicito | `planning.py` | Aggiunto `Ticket.tenant_id == plans[0].tenant_id` |
| **VAL-02** | `VoceCheck`/`CheckBody` senza bound (storage/memory) | `check_primo_livello.py` | `max_length` su label/descrizione + `max_length=100` voci |
| **VAL-03** | `DeauthorizeRequest.reason` senza bound | `planning.py` | `Field(min_length=3, max_length=2000)` |
| **VAL-04** | `feedback_analytics.days` → full-table scan | `planning.py` | `Query(ge=1, le=365)` |
| **RATE-01** | `POST /planning/replanning` senza rate limit | `planning.py` | `@limiter.limit("5/minute")` |
| **AI-01** | Nessun timeout sul client OpenAI → worker starvation | `ai/openai_service.py` | `OpenAI(timeout=120.0)` (copre tutti i consumatori) |
| **IMAP-01** | Email poller senza timeout IMAP → stall worker | `email_poller.py` | `MailBox(..., timeout=30)` |
| **AUT-01** | `RevokedToken` cresce illimitata (consultata ad ogni request) | `retention_service.py` | `cleanup_revoked_tokens()` nel retention job giornaliero |

### 🟢 Bassa — 10 risolte, 2 roadmap

| ID | Titolo | Stato |
|---|---|---|
| **RATE-02** | `POST /planning/confirm` senza rate limit | ✅ `@limiter.limit("10/minute")` |
| **VAL-05** | `MoveTicketRequest` ore/minuti/data senza range | ✅ `Field(ge/le)` + `pattern` data |
| **UPLOAD-02** | Firma ticket senza verifica immagine reale | ✅ `sniff_ext()` PNG/JPEG |
| **AI-02** | `raw_response` OpenAI completo in dict di errore | ✅ Troncato a 500 char, messaggio generico |
| **ERR-02** | `smart_read_pdf` inghiotte eccezione senza log | ✅ `logger.warning` aggiunto |
| **ERR-03** | `db_error(db, ...)`/`db_info(db, ...)` firma deprecata | ✅ Corrette 2 occorrenze |
| **AUT-02** | `COOKIE_SAMESITE` senza validazione valore | ✅ Whitelist + check `none`⇒`Secure` |
| **DEP-01** | PyPDF2 deprecato | ✅ Migrato a `pypdf==6.13.1` |
| **DEP-02** | `openai` range troppo ampio | ✅ Pinnato `==1.109.1` |
| **SEC-16** | Versioni disallineate (3.3.0/3.3.1) | ✅ Allineate a **3.3.2** (config.py, package.json, version.ts, deploy-version.json) |
| **CONF-02** | `has_openai_key` nel response body di `/planning/status` | ◻️ Accettato (feature-flag UI legittimo, no segreto esposto) |
| **CONF-03** | CSP con `unsafe-inline`/`unsafe-eval` (vincolo Next.js) | ⏳ Roadmap (nonce-based CSP via middleware) |

### 🔧 Supply chain — vulnerabilità reale risolta

`pip-audit` su `requirements.txt` segnalava **4 CVE su PyJWT 2.12.1** (PYSEC-2026-175/177/178/179) → aggiornato a **2.13.0**.
Migrazione PDF a `pypdf 6.13.1` (la 6.1.1 inizialmente scelta aveva ~8 CVE, ora su ultima patch sicura).
**Esito finale `pip-audit`: "No known vulnerabilities found".**

---

## 3. Conformità ISO 27001/27002 e NIS2 (nuovo)

Per lo stato vendibile a clienti regolati (manifatturiero/energetico/portuale → ambito NIS2) è stata aggiunta la
documentazione di compliance e i relativi controlli:

- **`docs/COMPLIANCE_ISO27001_27002_NIS2.md`** — mappatura dei **93 controlli ISO 27001:2022 Annex A / 27002:2022**
  e delle **misure minime NIS2 Art. 21/23** sui controlli reali del codice. Statement of Applicability sintetico:
  ~46 ✅ implementati, ~24 🟡 parziali, ~23 ⚪ N/A (controlli fisici delegati ai provider cloud), **0 ❌**.
- **`SECURITY.md`** (root) — coordinated vulnerability disclosure policy (ISO A.8.8 / NIS2 21.e).
- **`docs/INCIDENT_RESPONSE.md`** — runbook incidenti con tempistiche NIS2 Art. 23 (early warning 24h, notifica 72h, report 1 mese; ISO A.5.24–5.26).
- **`SECURITY_GUIDELINES_MAINTAI.md` §6** + **`SECURITY_CHECKLIST.md`** — sezione/blocco ISO/NIS2 con regole operative per ogni PR.
- **CI `security.yml`** — aggiunto job **SBOM (CycloneDX)** per la supply chain (NIS2 21.d).

**Unico gap tecnico rilevante per piena conformità NIS2 (21.j) / ISO A.8.5: l'MFA** — vedi §5 (roadmap, priorità Alta).

---

## 4. CONF-01 — azioni manuali ancora richieste (CRITICO)

Il segreto Supabase è ancora presente nella **history git** (commit `eac6a84` e precedenti). Il file è già fuori dal
tracking + `.gitignore` + secret-scan CI, ma:

1. **Ruotare** la password Supabase (dashboard → Database → reset) e aggiornare `DATABASE_URL` su Render. Valutare rotazione di `JWT_SECRET`/`ENCRYPTION_KEY`.
2. **Riscrivere la history** su un clone pulito:
   ```bash
   pip install git-filter-repo
   git clone <repo> maintai-clean && cd maintai-clean
   git filter-repo --path .claude/settings.local.json --invert-paths
   git push --force --all && git push --force --tags
   ```
3. Considerare il segreto **compromesso**: la rotazione (punto 1) è la difesa reale.

---

## 5. Cosa resta da fare (roadmap prima della vendita a soggetti NIS2)

| Priorità | Voce | Standard |
|---|---|---|
| 🔴 Alta | **CONF-01**: rotazione segreto + scrub history | A.8.24 / GDPR |
| 🔴 Alta | **MFA** (TOTP, obbligatorio admin) | A.8.5 / NIS2 21.j |
| 🟠 Media | Test di ripristino backup + BCP/DR documentato | A.5.29 / NIS2 21.c |
| 🟠 Media | DPA formali fornitori (OpenAI/Supabase/Render) + registro trattamenti | A.5.19/5.34 |
| 🟡 Bassa | Backlog ESLint (~116) → attivare gate bloccante | A.8.28 |
| 🟡 Bassa | CSP nonce-based (CONF-03) | A.8.26 |
| 🟡 Bassa | Alerting/SIEM su `SystemLog` | A.8.16 |
| 🟡 Bassa | Approvazione formale management ISMS (clausole 4–6/9) | ISO 27001 |

---

## 6. Aree verificate pulite (nessun problema)

SQL injection (no `text()` con f-string), path traversal (UUID/path fissi), IDOR (filtro tenant ORM + `check_tenant_ownership`),
abuso impersonazione superadmin (`X-Tenant-Id` solo se `ruolo==superadmin`), SSRF su Open-Meteo/OpenAI (host fissi),
export Excel (filtra `tenant_id`), output AI (`response_format` JSON + anonymizer PII), serving documenti asset (whitelist content-type).

---

## 7. Verifica finale

| Controllo | Esito |
|---|---|
| Backend test suite (`pytest`) | ✅ **93/93 passati** |
| `pip-audit -r backend/requirements.txt` | ✅ **0 vulnerabilità** |
| Smoke test nuove validazioni Pydantic (VAL-01/02/03/05) | ✅ Tutti i payload abusivi → 422 |
| Migrazione `pypdf` (estrazione testo PDF) | ✅ Test verdi, nessuna regressione |
| Versioni allineate | ✅ **3.3.2** ovunque |

---

*Report finale generato su codice reale — 2026-06-08. Riferimenti: `docs/SECURITY_GUIDELINES.md`, `docs/SECURITY_CHECKLIST.md`,*
*`docs/SECURITY_GUIDELINES_MAINTAI.md`, `docs/COMPLIANCE_ISO27001_27002_NIS2.md`.*
