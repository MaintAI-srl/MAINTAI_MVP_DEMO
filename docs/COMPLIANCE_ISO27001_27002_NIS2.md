# MaintAI — Conformità ISO/IEC 27000, 27001, 27002 e Direttiva NIS2

> **Documento di compliance enterprise.** Mappa i controlli di sicurezza implementati in MaintAI agli standard
> **ISO/IEC 27000** (vocabolario e overview ISMS), **ISO/IEC 27001:2022** (requisiti ISMS + Annex A),
> **ISO/IEC 27002:2022** (guida ai controlli) e alla **Direttiva (UE) 2022/2555 (NIS2)**.
>
> Versione: **1.0 — 2026-06-08** · Allineato al codice backend `3.3.1`.
> Complementare a [`SECURITY_GUIDELINES.md`](SECURITY_GUIDELINES.md), [`SECURITY_GUIDELINES_MAINTAI.md`](SECURITY_GUIDELINES_MAINTAI.md),
> [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) e all'ultimo audit [`SECURITY_AUDIT_2026-06-08.md`](SECURITY_AUDIT_2026-06-08.md).
>
> **Stato:** documentazione di *readiness* alla certificazione. MaintAI **non è ancora certificato** ISO 27001:
> questo documento è la base di evidenza tecnica (Statement of Applicability tecnico) che un cliente enterprise
> o un Organismo di Certificazione può usare come punto di partenza per l'audit.

---

## Indice

1. [Scopo e contesto normativo (ISO 27000)](#1-scopo-e-contesto-normativo-iso-27000)
2. [ISO/IEC 27001:2022 — requisiti dell'ISMS (Clausole 4–10)](#2-isoiec-270012022--requisiti-dellisms-clausole-410)
3. [ISO/IEC 27001:2022 Annex A / ISO 27002:2022 — mappatura dei controlli](#3-isoiec-270012022-annex-a--iso-270022022--mappatura-dei-controlli)
4. [Direttiva NIS2 (UE 2022/2555) — misure minime e obblighi](#4-direttiva-nis2-ue-20222555--misure-minime-e-obblighi)
5. [Gap analysis e roadmap di certificazione](#5-gap-analysis-e-roadmap-di-certificazione)
6. [Statement of Applicability (sintesi)](#6-statement-of-applicability-sintesi)

---

## 1. Scopo e contesto normativo (ISO 27000)

**ISO/IEC 27000** definisce il vocabolario e i principi della famiglia di standard sull'Information Security
Management System (ISMS). I termini chiave applicati in questo documento:

| Termine ISO 27000 | Definizione | Applicazione MaintAI |
|---|---|---|
| **Information security** | Preservazione di **C**onfidenzialità, **I**ntegrità, **D**isponibilità (CIA) | Isolamento multi-tenant (C), audit log immutabili (I), HA cloud Render/Vercel (A) |
| **ISMS** | Sistema di gestione per stabilire, implementare, mantenere e migliorare la sicurezza | Questo set di documenti + processi di sviluppo sicuro |
| **Risk** | Effetto dell'incertezza sugli obiettivi | Vedi §5 e registro rischi |
| **Control** | Misura che modifica il rischio | Vedi §3 (mappatura Annex A) |
| **Asset** | Qualunque cosa di valore per l'organizzazione | Dati tenant, credenziali, codice, modelli AI, DB |
| **Threat / Vulnerability** | Causa potenziale di incidente / debolezza sfruttabile | Tracciate nell'audit `SECURITY_AUDIT_*` (SEC-NN) |

**Perimetro dell'ISMS (ISMS scope):** la piattaforma SaaS MaintAI — backend FastAPI, frontend Next.js,
database PostgreSQL (Supabase/Render), storage file, integrazioni OpenAI / Open-Meteo / IMAP, e i processi
di sviluppo, deploy e gestione incidenti associati.

**Triade CIA — sintesi per MaintAI:**
- **Confidenzialità:** JWT + RBAC, isolamento `tenant_id` su ogni query, cifratura at-rest Fernet delle credenziali IMAP, TLS in transito.
- **Integrità:** validazione Pydantic, audit trail in `SystemLog`, magic-bytes sugli upload, anti-CSRF, token_version per invalidazione sessioni.
- **Disponibilità:** rate limiting (anti-DoS applicativo), resilienza dei background job, retry con backoff, infrastruttura cloud gestita.

---

## 2. ISO/IEC 27001:2022 — requisiti dell'ISMS (Clausole 4–10)

ISO 27001 richiede un sistema di gestione, non solo controlli tecnici. Stato di copertura:

| Clausola | Requisito | Stato MaintAI | Evidenza / Gap |
|---|---|---|---|
| **4 — Contesto** | Comprendere organizzazione, parti interessate, scope ISMS | 🟡 Parziale | Scope tecnico definito qui; manca analisi formale stakeholder |
| **5 — Leadership** | Politica di sicurezza, ruoli e responsabilità | 🟡 Parziale | Policy tecnica in `SECURITY_GUIDELINES*`; serve policy firmata dal management |
| **6 — Pianificazione** | Risk assessment, risk treatment, obiettivi | 🟡 Parziale | Audit SEC-NN = risk register tecnico; serve metodologia formale (§5) |
| **7 — Supporto** | Risorse, competenze, consapevolezza, doc. controllata | 🟢 Buono | Documentazione versionata in git; `CLAUDE.md` definisce le competenze del processo |
| **8 — Operatività** | Esecuzione dei processi di risk treatment | 🟢 Buono | SDLC sicuro, CI security (`/.github/workflows/security.yml`), agente `maintai-stability-security` |
| **9 — Valutazione prestazioni** | Monitoraggio, audit interni, riesame direzione | 🟡 Parziale | Audit periodici (`SECURITY_AUDIT_*`); serve calendario riesami formale |
| **10 — Miglioramento** | Non conformità, azioni correttive, miglioramento continuo | 🟢 Buono | Tracking finding SEC-NN con stato/remediation; CI bloccante |

> **Nota di vendita:** per i clausoli 4–6/9 (parti gestionali) serve un atto formale del management.
> I controlli **tecnici** (Annex A) sono in larga parte già implementati — vedi §3.

---

## 3. ISO/IEC 27001:2022 Annex A / ISO 27002:2022 — mappatura dei controlli

ISO 27001:2022 Annex A elenca **93 controlli** in 4 temi; ISO 27002:2022 ne fornisce la guida implementativa.
Legenda stato: ✅ implementato · 🟡 parziale · ⚪ organizzativo/non applicabile al codice · ❌ gap.

### A.5 — Controlli organizzativi (5.1–5.37)

| # | Controllo | Stato | Evidenza MaintAI |
|---|---|---|---|
| 5.1 | Politiche per la sicurezza delle informazioni | 🟡 | `docs/SECURITY_GUIDELINES*.md`, `CLAUDE.md` §Sicurezza |
| 5.2 | Ruoli e responsabilità | ✅ | RBAC: ruoli `superadmin`/`responsabile`/`tecnico` in JWT, `require_roles()` |
| 5.3 | Segregazione dei compiti | ✅ | `require_superadmin`, separazione ruoli operatore/planner |
| 5.7 | Threat intelligence | 🟡 | CI `pip-audit`/`npm audit`; advisory dipendenze |
| 5.8 | Sicurezza nei progetti | ✅ | SDLC sicuro, checklist pre-PR, agente QA security |
| 5.9–5.11 | Inventario e gestione degli asset | 🟡 | Modelli ORM = inventario dati; manca asset register formale HW/SW |
| 5.12–5.14 | Classificazione, etichettatura, trasferimento info | 🟡 | Dati tenant isolati; PII mascherata (`anonymizer.mask_text`) |
| 5.15 | Controllo accessi | ✅ | `get_current_user_payload`, `get_current_tenant_id`, `check_tenant_ownership` |
| 5.16 | Gestione delle identità | ✅ | Tabella `Utente`, `token_version`, disattivazione utente/tenant |
| 5.17 | Informazioni di autenticazione | ✅ | bcrypt (cost ≥12), policy password complessa, no credenziali default |
| 5.18 | Diritti di accesso | ✅ | Revoca via `RevokedToken` (blacklist jti) + `token_version` |
| 5.19–5.22 | Sicurezza nei rapporti coi fornitori | 🟡 | OpenAI/Supabase/Render: DPA da formalizzare; dati minimizzati nei prompt |
| 5.23 | Sicurezza servizi cloud | ✅ | Deploy gestito Vercel/Render/Supabase, segreti in env, bucket privati |
| 5.24–5.26 | Gestione incidenti | 🟡 | `SystemLog` + logging; serve runbook incidenti formale (→ NIS2 §4) |
| 5.28 | Raccolta delle evidenze | ✅ | Audit trail persistente `SystemLog` (tenant, utente, azione, timestamp) |
| 5.29–5.30 | Continuità operativa / ICT readiness | 🟡 | Backup gestito Supabase; serve DR plan documentato (→ NIS2) |
| 5.31–5.34 | Requisiti legali, IP, privacy/PII | 🟡 | GDPR: minimizzazione, cifratura; serve registro trattamenti formale |
| 5.35–5.36 | Riesame e conformità della sicurezza | ✅ | Audit periodici `SECURITY_AUDIT_*`, CI bloccante |
| 5.37 | Procedure operative documentate | 🟢 | `CLAUDE.md`, `docs/deploy_cloud.md`, runbook |

### A.6 — Controlli relativi alle persone (6.1–6.8)

| # | Controllo | Stato | Evidenza MaintAI |
|---|---|---|---|
| 6.1–6.2 | Screening, termini d'impiego | ⚪ | Processo HR del cliente/fornitore |
| 6.3 | Consapevolezza e formazione | 🟡 | `SECURITY_GUIDELINES*` come materiale; serve programma training (→ NIS2 art.21.g) |
| 6.4 | Processo disciplinare | ⚪ | Organizzativo |
| 6.5 | Responsabilità post-cessazione | ✅ | Disattivazione utente → `is_active=False`, invalidazione token immediata |
| 6.7 | Lavoro da remoto | ✅ | TLS, cookie `Secure`/`HttpOnly`/`SameSite`, MFA (roadmap) |
| 6.8 | Segnalazione eventi di sicurezza | 🟡 | Canale interno via `SystemLog`/log; serve procedura formale |

### A.7 — Controlli fisici (7.1–7.14)

| # | Controllo | Stato | Evidenza MaintAI |
|---|---|---|---|
| 7.1–7.14 | Perimetro fisico, accessi, supporti, smaltimento | ⚪ | **Delegato ai data center** Vercel/Render/Supabase (certificati ISO 27001 / SOC 2). Responsabilità del cloud provider sotto modello di responsabilità condivisa. |

> Per i controlli fisici MaintAI eredita la conformità dei provider IaaS/PaaS. Conservare i loro
> certificati ISO 27001/SOC 2 come evidenza (Vercel, Render, Supabase/AWS).

### A.8 — Controlli tecnologici (8.1–8.34) — *nucleo tecnico*

| # | Controllo | Stato | Evidenza MaintAI (file) |
|---|---|---|---|
| 8.1 | Dispositivi endpoint utente | ⚪ | Lato cliente |
| 8.2 | Diritti di accesso privilegiato | ✅ | `require_superadmin`, impersonazione tenant solo per superadmin (`X-Tenant-Id`) |
| 8.3 | Restrizione accesso alle informazioni | ✅ | Filtro `tenant_id` su ogni query; `check_tenant_ownership` → 404 |
| 8.4 | Accesso al codice sorgente | ✅ | Repo privato GitHub, branch protetti, review |
| 8.5 | Autenticazione sicura | ✅ | JWT HS256, scadenza configurabile, blacklist + token_version (`security.py`) |
| 8.6 | Gestione della capacità | 🟡 | Cloud autoscaling; rate limiting applicativo (`rate_limiter.py`) |
| 8.7 | Protezione da malware | ✅ | Magic-bytes upload (`file_validation.py`), serving `attachment`+`nosniff` |
| 8.8 | Gestione vulnerabilità tecniche | ✅ | CI `pip-audit` + `npm audit`, dipendenze pinnate (`requirements.txt`) |
| 8.9 | Gestione della configurazione | ✅ | Config via env, fail-fast su segreti mancanti (`config.py`, `security.py`) |
| 8.10 | Cancellazione delle informazioni | 🟡 | Soft-delete ticket; serve policy retention/hard-delete documentata |
| 8.11 | Mascheramento dei dati | ✅ | `anonymizer.mask_text` su PII nei log/prompt AI |
| 8.12 | Prevenzione data leakage | ✅ | Isolamento multi-tenant, `response_model` (no over-fetch ORM) |
| 8.13 | Backup delle informazioni | ✅ | Backup gestito Supabase/PostgreSQL (point-in-time) |
| 8.14 | Ridondanza | ✅ | Infrastruttura cloud ridondata (Vercel/Render) |
| 8.15 | Logging | ✅ | `SystemLog` + `logger_db` (tenant, utente, azione, esito) |
| 8.16 | Attività di monitoraggio | 🟡 | Log persistenti + pagina `/admin/logs`; serve alerting/SIEM (→ roadmap) |
| 8.17 | Sincronizzazione orologi | ✅ | Timestamp UTC server-side (`datetime.now(timezone.utc)`) |
| 8.18 | Uso di utility privilegiate | ✅ | Endpoint admin protetti da `require_superadmin` |
| 8.19–8.20 | Sicurezza software / reti | ✅ | CORS allowlist, anti-CSRF Origin/Referer (`main.py`), TLS |
| 8.21 | Sicurezza dei servizi di rete | ✅ | HTTPS forzato, HSTS in prod, security headers |
| 8.22 | Segregazione delle reti | ✅ | Separazione frontend/backend/DB; bucket storage privati |
| 8.23 | Web filtering | ⚪ | N/A (no proxy in uscita generico) |
| 8.24 | Uso della crittografia | ✅ | TLS in transito, Fernet at-rest, bcrypt password (`security.py`) |
| 8.25 | Secure development lifecycle | ✅ | SDLC sicuro, checklist, CI security, agenti dedicati |
| 8.26 | Requisiti di sicurezza applicativi | ✅ | Validazione Pydantic, RBAC, rate limit per endpoint |
| 8.27–8.28 | Architettura sicura / secure coding | ✅ | Linee guida OWASP, no `text()` con f-string, magic-bytes, output AI validato |
| 8.29 | Test di sicurezza in sviluppo | 🟡 | Test backend (`pytest`); serve DAST/pen-test periodico |
| 8.30 | Sviluppo in outsourcing | ⚪ | Sviluppo interno |
| 8.31 | Separazione ambienti dev/test/prod | ✅ | DB demo separato (`demo.db`), env separate, preview Vercel |
| 8.32 | Gestione del cambiamento | ✅ | Git + migrazioni Alembic versionate + review |
| 8.33 | Informazioni di test | ✅ | `failure_seed.py` usa dati sintetici, no PII reale |
| 8.34 | Protezione sistemi durante audit | ✅ | Audit su clone/read-only, no impatto produzione |

**Copertura tecnologica (A.8):** ~26/34 controlli ✅ implementati, ~6 🟡 parziali, ~2 ⚪ N/A.

---

## 4. Direttiva NIS2 (UE 2022/2555) — misure minime e obblighi

La **NIS2** si applica a soggetti *essenziali* e *importanti*. MaintAI gestisce manutenzione per impianti
**manifatturieri, energetici e portuali** — settori che possono rientrare nell'ambito NIS2: come **fornitore
di servizi ICT a soggetti regolati**, MaintAI deve poter dimostrare le misure dell'**Art. 21** ed essere pronto
a supportare gli obblighi di **notifica incidenti (Art. 23)** del cliente lungo la catena di fornitura (Art. 21.d).

### 4.1 Art. 21(2) — Misure minime di gestione del rischio

| # | Misura NIS2 | Stato | Evidenza MaintAI |
|---|---|---|---|
| (a) | Policy di analisi del rischio e sicurezza dei sistemi | 🟡 | `SECURITY_GUIDELINES*`, audit SEC-NN; serve risk-methodology formale |
| (b) | Gestione degli incidenti | 🟡 | `SystemLog` + logging; serve **runbook** + canale notifica (vedi 4.2) |
| (c) | Continuità operativa, backup, disaster recovery, crisi | 🟡 | Backup Supabase; serve **BCP/DR documentato** + test di ripristino |
| (d) | Sicurezza della supply chain | ✅ | Dipendenze pinnate + CI audit; OpenAI/Supabase con dati minimizzati; SBOM (roadmap) |
| (e) | Sicurezza in acquisizione/sviluppo/manutenzione + **vulnerability handling** | ✅ | SDLC sicuro, CI security, processo audit SEC-NN, disclosure (`SECURITY.md`) |
| (f) | Politiche di valutazione dell'efficacia delle misure | 🟡 | Audit periodici; serve KPI/metriche di efficacia formali |
| (g) | Igiene informatica di base e **formazione** | 🟡 | Linee guida come base; serve programma di awareness/training |
| (h) | Uso della **crittografia** e cifratura | ✅ | TLS, Fernet at-rest, bcrypt; policy crypto documentata (§3 A.8.24) |
| (i) | Sicurezza HR, **controllo accessi**, gestione asset | ✅ | RBAC, multi-tenant, `is_active`, audit accessi |
| (j) | **MFA** / autenticazione continua, comunicazioni sicure | ❌→🟡 | TLS + cookie sicuri presenti; **MFA in roadmap** (gap prioritario) |

### 4.2 Art. 23 — Obblighi di notifica degli incidenti

NIS2 impone tempistiche stringenti che MaintAI deve poter **supportare tecnicamente** verso il cliente:

| Fase | Termine | Capacità MaintAI |
|---|---|---|
| **Early warning** | entro **24h** dalla scoperta | Audit trail `SystemLog` consente ricostruzione tempestiva |
| **Notifica incidente** | entro **72h** | Log con timestamp UTC, tenant, utente, azione → evidenze per la notifica |
| **Report finale** | entro **1 mese** | Storico log persistente + report audit |

**Azione richiesta per piena conformità (4.2):** definire un **Incident Response Runbook** (`docs/INCIDENT_RESPONSE.md`,
roadmap) con: classificazione severità, catena di escalation, contatti CSIRT nazionale, template di notifica 24h/72h/1mese.

### 4.3 Governance (Art. 20) e responsabilità degli organi di gestione

NIS2 rende il **management direttamente responsabile**. Per la vendita a soggetti NIS2, MaintAI deve fornire:
- approvazione formale delle misure di sicurezza da parte della direzione (clausola ISO 27001 §5);
- evidenza di formazione del management sui rischi cyber.

---

## 5. Gap analysis e roadmap di certificazione

### Gap prioritari (da chiudere per certificazione / vendita a soggetti NIS2)

| Priorità | Gap | Standard | Azione | Tipo |
|---|---|---|---|---|
| 🔴 Alta | **MFA** assente | A.8.5 / NIS2 21.j | Implementare TOTP/MFA (obbligatorio admin) | Tecnico |
| 🔴 Alta | Runbook incidenti assente | A.5.24 / NIS2 23 | Creare `docs/INCIDENT_RESPONSE.md` | Documentale |
| 🟠 Media | BCP/DR non documentato + test | A.5.29 / NIS2 21.c | Documentare e testare ripristino backup | Documentale + test |
| 🟠 Media | Risk-methodology formale | ISO 27001 §6 | Adottare metodologia (es. ISO 27005) | Documentale |
| 🟠 Media | Registro trattamenti GDPR / DPA fornitori | A.5.19/5.34 | Formalizzare DPA OpenAI/Supabase/Render | Legale |
| 🟡 Bassa | Programma awareness/training | A.6.3 / NIS2 21.g | Definire piano formativo | Documentale |
| 🟡 Bassa | Alerting/SIEM su log | A.8.16 | Integrare alerting (es. Sentry/Logtail) | Tecnico |
| 🟡 Bassa | SBOM per release | NIS2 21.d | Generare CycloneDX in CI | Tecnico |
| 🟡 Bassa | Backlog ESLint (gate non bloccante) | A.8.28 | Pulire ~116 lint e attivare gate | Tecnico |

### Punti di forza già pronti per l'audit

- Isolamento multi-tenant robusto e consistente (`check_tenant_ownership`, filtro `tenant_id`).
- Autenticazione moderna (JWT con revoca, `token_version`, bcrypt, cookie sicuri, anti-CSRF).
- Crittografia in transito e at-rest, fail-fast su segreti mancanti.
- Supply chain: dipendenze pinnate + CI di audit + secret scanning.
- Audit trail persistente e documentazione di sicurezza versionata e mantenuta.

---

## 6. Statement of Applicability (sintesi)

| Tema Annex A 2022 | Controlli | ✅ | 🟡 | ⚪/N.A. | ❌ |
|---|---|---|---|---|---|
| A.5 Organizzativi | 37 | ~18 | ~15 | ~4 | 0 |
| A.6 Persone | 8 | ~2 | ~3 | ~3 | 0 |
| A.7 Fisici | 14 | 0 | 0 | 14 (delega cloud) | 0 |
| A.8 Tecnologici | 34 | ~26 | ~6 | ~2 | 0 |
| **Totale** | **93** | **~46** | **~24** | **~23** | **0** |

> Nessun controllo applicabile risulta **completamente assente** a livello tecnico: i gap residui sono
> prevalentemente **documentali/organizzativi** (clausole gestionali ISO 27001) e l'unico gap tecnico
> rilevante è l'**MFA** (NIS2 21.j / A.8.5), già in roadmap come priorità Alta.

---

*Documento di compliance mantenuto insieme all'ISMS. Aggiornare a ogni audit di sicurezza e ad ogni cambiamento*
*architetturale rilevante. Riferimenti normativi: ISO/IEC 27000:2018, ISO/IEC 27001:2022, ISO/IEC 27002:2022,*
*Direttiva (UE) 2022/2555 (NIS2), recepimento italiano D.lgs. 138/2024.*
