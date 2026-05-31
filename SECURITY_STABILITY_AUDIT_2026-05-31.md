# Report Audit Sicurezza & Stabilità — MaintAI

**Data:** 2026-05-31
**Branch:** `claude/project-security-audit-8Pt87`
**Scope:** Audit completo, sola lettura, sull'intero progetto (backend + frontend)
**Metodo:** Code review statica condotta da due agenti specializzati (`maintai-stability-security`, `maintai-qa-reviewer`) + verifiche manuali su segreti, git history, config e routing DB.
**Nota:** L'ambiente di audit non aveva dipendenze backend né `node_modules` installati: test (`pytest`) e build/lint frontend **non sono stati eseguiti a runtime**. Le valutazioni "funziona" derivano da lettura del codice, non da esecuzione.

---

## 1. Stato attuale del progetto

Progetto maturo e di buona fattura: 104 file Python, 94 file TS/TSX, 33 route API, ~25 servizi backend.

**Verdetto sintetico:**
- **Sicurezza:** impianto solido di base (fail-closed su segreti, isolamento tenant via ORM event listener, dipendenze pinnate). Restano **2 problemi critici** e **7 alti** da chiudere prima di considerarlo production-hardened.
- **Stabilità/Qualità:** **2 bug critici frontend** (crash runtime React + dead code), oltre a UX degradata e drift di contratto. La pagina `/planning` è l'area più fragile.
- **Documentazione:** diversi punti di `CLAUDE.md` non corrispondono al codice reale (vedi §6).

---

## 2. Punti di forza confermati

- ✅ **Nessun segreto committato**, né nello stato attuale né nella git history (solo `.env.example` con placeholder).
- ✅ `.gitignore` robusto (`.env`, `*.db`, chiavi di firma Tauri, `uploads/`).
- ✅ `JWT_SECRET` ed `ENCRYPTION_KEY` **obbligatorie senza fallback**: il backend fa *fail-closed* all'avvio (`backend/core/security.py:18-70`).
- ✅ Password IMAP cifrate con Fernet; validazione formato chiave all'avvio.
- ✅ **Dipendenze pinnate e recenti** (FastAPI 0.135.1, SQLAlchemy 2.0.48, pyjwt 2.12.1, cryptography 46.0.6); `slowapi` già presente per rate limiting; protezione CSRF e ORM event listener per il filtro tenant.
- ✅ Whitelist estensioni sugli allegati ticket (`ALLOWED_UPLOAD_EXTENSIONS`).
- ✅ Motore planner deterministico puro e testabile, separato dall'ORM.

---

## 3. Problemi di SICUREZZA

### 🔴 CRITICO

| ID | File | Problema | Fix |
|---|---|---|---|
| **SEC-C1** | `backend/api/routes/planning.py` (~152-190, `_batch_completion_pct()`) | Query su `Ticket.id` **senza filtro `tenant_id`**. L'ORM event listener non scatta per gli helper che usano `.filter()` raw senza context var: le percentuali di completamento dei piani confermati sono **contaminate da ticket cross-tenant**. | Aggiungere `.filter(Ticket.tenant_id.in_([...]))` basato sui tenant del piano. |
| **SEC-C2** | `backend/api/routes/check_primo_livello.py` | `GET /check/public/{token}` e `POST /check/public/{token}/segnala` **non richiedono autenticazione** (workflow QR, intenzionale) ma **senza rate limiting né limiti di lunghezza**: `segnala_anomalia_pubblica()` crea ticket BD in qualsiasi tenant → abuso/DoS/flood. | `slowapi` rate limit + `max_length=2000` su `descrizione`. |

### 🟠 ALTO

| ID | File | Problema | Fix |
|---|---|---|---|
| **SEC-A1** | `manuali.py` `upload_manuale()` | Nessun controllo estensione/MIME/magic-bytes (solo limite 25MB). Qualsiasi file passa a PyPDF2. | Verificare estensione `.pdf` + `application/pdf` + magic bytes `%PDF`. |
| **SEC-A2** | `tickets.py` `upload_ticket_allegato()` | Whitelist estensioni OK, ma manca validazione MIME/magic-bytes (estensione falsificabile). | Aggiungere sniff magic-bytes coerente con l'estensione. |
| **SEC-A3** | `planning.py` `confirm_plan()`, `deauthorize_plan()`, `clear_gantt()` | **Nessun controllo di ruolo**: qualsiasi utente autenticato (anche sola lettura / tecnico) può confermare, deautorizzare o svuotare piani. | Dependency `require_role(["Admin","Planner","SuperAdmin"])`. |
| **SEC-A4** | `emergency.py` `nearest_technicians()` | Query `Impianto`/`Sito` (righe ~132-210) senza `.filter(tenant_id==...)`. L'ORM listener mitiga per i non-superadmin, ma **non** durante l'impersonation SuperAdmin. | Filtro `tenant_id` esplicito su tutte le query. |
| **SEC-A5** | `planning.py` `GeneratePlanRequest.days` | `days: int = 7` senza bound: `days=10000` → generazione contesto AI enorme (costo/DoS). | `Field(default=7, ge=1, le=90)`. |
| **SEC-A6** | `security.py:77` `COOKIE_SECURE` | Default `false`: in produzione su Render deve essere `true`, altrimenti cookie JWT trasmesso anche su HTTP. | Default `true`, opt-out esplicito solo per dev locale. |
| **SEC-A7** | `diagnostic.py` `start_session()` (~107) | Query `AttivitaManutenzione` senza filtro `tenant_id`: attività di altri tenant nel contesto diagnostico. | Aggiungere `.filter(AttivitaManutenzione.tenant_id == tenant_id)`. |

### 🟡 MEDIO

- **SEC-M1** `planning.py` `DeauthorizeRequest.reason` — nessun `min_length` (motivazione obbligatoria aggirabile con stringa vuota).
- **SEC-M2** `security.py:34` — JWT lifetime **7 giorni**, lungo per un sistema industriale: valutare 8-24h + refresh.
- **SEC-M3** `retention_service.py` — pulisce i ticket eliminati ma **non** la tabella `revoked_tokens`: la blacklist JTI cresce illimitata.
- **SEC-M4 / M5** — `planning.feedback_analytics` (`days=30`) e `report.get_report_economico` (`mesi=12`): parametri `Query` senza bound.
- **SEC-M6 / M7** — `tickets.QuickTicketCreate.descrizione` e `check_primo_livello.SegnalazioneBody.descrizione`: nessun `max_length`/`min_length`.
- **SEC-M8** `emergency.py` — N+1 + geocoding Nominatim esterno per ogni tecnico: rischio DoS, serve caching.
- **SEC-M9** `email_poller.py` — processa **tutte** le email non lette per ciclo senza limite di batch: inbox grande → picco di memoria.
- **SEC-M10** — Diverse route fanno `HTTPException(500, detail=f"Errore interno: {exc}")` esponendo il messaggio dell'eccezione al client.
- **SEC-M11** `backend/scratch/debug_db.py` — path sviluppatore hardcoded nel repo (`backend/scratch/` è gitignored, ma il file risulta tracciato: verificare).

### 🟢 BASSO

- **SEC-B1** `asset_documenti.py` — manca magic-bytes (whitelist estensioni presente).
- **SEC-B2** JWT restituito nel body di login (by design per Tauri) — documentare esplicitamente.
- **SEC-B3** `requirements.txt` — `openai>=1.0.0,<2.0.0` troppo largo: pinnare a minor.
- **SEC-B4** `pdf_service.py:72` — `except Exception` silenzioso senza logging.

---

## 4. Problemi di STABILITÀ / QUALITÀ

### 🔴 CRITICO

| ID | File | Problema |
|---|---|---|
| **QA-C1** | `frontend/app/planning/page.tsx:203-204` (`TicketBlock`) | **Violazione React Rules of Hooks**: `useZoom()` (→`useContext`) chiamato dentro `if (view === "day")`. Al cambio view (`day`↔`week`/`2week`) → **crash runtime `Invalid hook call`**. È il flusso di navigazione principale del planning, non un edge case. **Fix:** spostare `const zoom = useZoom()` fuori dal condizionale. |
| **QA-C2** | `frontend/app/planning/page.tsx:862 e 944` | **Doppia definizione di `generateAIPlan`**: JS usa la seconda (semplice), la prima (con warm-up `/health` e `generandoStatus`) è dead code. Oggi innocuo (bottone disabilitato) ma è una bomba a orologeria alla riattivazione del feature flag. **Fix:** rimuovere il duplicato (righe ~944-969), tenere la versione con warm-up. |

### 🟠 ALTO

| ID | File | Problema |
|---|---|---|
| **QA-A1** | `planning/page.tsx:1269` | Tooltip efficiency score referenzia campi inesistenti (`rispetto_priorita`, `riduzione_spostamenti`, `matching_competenze`); il backend restituisce `bilanciamento_70_30`, `match_skill`, `ottimizzazione_meteo`. **3 campi su 5 mostrano `undefined%`.** Fix 1 riga. |
| **QA-A2** | `planning/page.tsx:1563` | `StoricoPiani` racchiuso in `<div style={{display:"none"}}>`: feature documentata ma **invisibile**. `loadStorico` viene comunque chiamato (API inutile). |
| **QA-A3** | `planning/types.ts:3-19` (`TicketData`) | Mancano `sito_name` e `impianto_name`, che il backend serializza sempre e il tooltip hover legge: contratto di tipo non allineato. |

### 🟡 MEDIO

- **QA-M1** `api.ts` — `/planning/replanning` non in `SLOW_ENDPOINTS`: usa timeout 30s invece di 120s → timeout su cold start Render.
- **QA-M2** `ReplanModal.tsx:71` — non gestisce il 503 del feature flag `AI_PLANNING_ENABLED`: messaggio d'errore generico.
- **QA-M3** **Versione incoerente**: `CLAUDE.md`=3.2.1, `version.ts`/`config.py`=3.3.0, `package.json`=3.1.7. Impossibile tracciare le build.

### 🟢 BASSO

- **QA-B1** `planning/page.tsx:1143` ↔ `planning.py MoveTicketRequest` — `skip_engine_validation` inviato dal frontend ma non dichiarato lato Pydantic (scartato silenziosamente).
- **QA-B2** `backend/core/init_db.py:8` — `PlannerFeedback` e `AssetConditionReading` non importati prima di `create_all()` (salvati solo dal fallback `_ensure_columns()`).

---

## 5. Codice "fantasma" / feature non cablate (tech debt)

Componenti completi e collegati a endpoint funzionanti, ma **mai montati** in nessuna pagina navigabile:
- `RollingAnalysisPanel.tsx`
- `DeferredWOPanel.tsx`
- Pulsante "Ricalcola" disattivato con anti-pattern `{false && ...}` (`planning/page.tsx:1351`)
- Endpoint backend `POST /planning/feedback` e `GET /planning/opportunistic` implementati ma senza UI che li invochi.

---

## 6. Drift documentazione (CLAUDE.md vs codice reale)

| CLAUDE.md dichiara | Realtà nel codice |
|---|---|
| `get_db` instrada su `demo.db` se JWT `is_demo=True` | **Non implementato**: `dependencies.py` restituisce sempre il DB principale; nessun riferimento a `is_demo`/`DEMO_DATABASE_URL`. Gli utenti demo userebbero il DB di produzione. |
| Dashboard con polling 30s | In realtà **event-driven** (`maintai:data-changed`, `focus`). |
| Versione 3.2.1 | Codice a 3.3.0 (e `package.json` a 3.1.7). |

> ⚠️ Il primo punto è anche un tema di **isolamento dati**: se esistono account demo, condividono il DB reale.

---

## 7. Stato test / build

- **Backend test (`pytest backend/tests/`):** 10 file di test presenti (auth, privacy, planner_engine, ai_planner_service, scheduler, conditions, scadenze…). **Non eseguibili nell'ambiente di audit** (dipendenze non installate). Da validare in CI.
- **Frontend build/lint:** `node_modules` assente nell'ambiente di audit → non eseguiti.
- **Raccomandazione:** eseguire `pytest` e `npm run build && npm run lint` in CI prima del prossimo deploy; almeno **QA-C1** (crash hooks) dovrebbe emergere come errore di lint `react-hooks/rules-of-hooks`.

---

## 8. Backlog prioritizzato (consigliato)

**Blocco 1 — Prima del prossimo rilascio (bloccanti):**
1. **QA-C1** — spostare `useZoom()` fuori dal condizionale (crash runtime attivo).
2. **QA-C2** — eliminare il duplicato `generateAIPlan`.
3. **SEC-C1** — filtro `tenant_id` in `_batch_completion_pct()` (leak cross-tenant).
4. **SEC-C2** — rate limit + `max_length` sugli endpoint pubblici `/check/public/*`.

**Blocco 2 — Hardening sicurezza (alto ROI, poche righe):**
5. **SEC-A3** — role check su `confirm/deauthorize/clear` (~3 righe/endpoint).
6. **SEC-A5** — `Field(ge=1, le=90)` su `days` (1 riga).
7. **SEC-A7 / SEC-A4** — filtro `tenant_id` su diagnostic e emergency.
8. **SEC-A1 / SEC-A2** — validazione MIME/magic-bytes sugli upload.
9. **SEC-A6** — `COOKIE_SECURE` default `true`.

**Blocco 3 — UX e contratto:**
10. **QA-A1** — fix nomi campi tooltip efficiency.
11. **QA-A2** — rendere visibile `StoricoPiani` (o rimuovere `loadStorico`).
12. **QA-A3** — aggiungere `sito_name`/`impianto_name` a `TicketData`.
13. **QA-M1** — `/planning/replanning` in `SLOW_ENDPOINTS`.

**Blocco 4 — Igiene/manutenzione:**
14. Allineare le versioni (single source of truth).
15. Allineare CLAUDE.md alla realtà (demo DB routing, polling dashboard).
16. SEC-M3 (cleanup `revoked_tokens`), SEC-M10 (non esporre `exc` nei 500), bound sui restanti `Query`.

---

## 9. Conclusione

Il progetto ha **fondamenta di sicurezza buone** (gestione segreti, fail-closed, dipendenze pinnate, isolamento tenant via ORM) ma presenta **falle puntuali di isolamento tenant** in helper/route che bypassano l'event listener, **controlli di ruolo mancanti** su operazioni sensibili del planner, e **validazione upload incompleta**. Sul fronte stabilità, la pagina `/planning` ha **2 bug critici frontend** che vanno chiusi subito (crash runtime + dead code).

**Nessuno dei problemi è di natura sistemica o richiede refactoring architetturale**: la maggior parte sono fix mirati da poche righe. Chiudendo il Blocco 1 e 2 il progetto passa da "demo solido" a "production-hardened".

> Versione originale del report: audit di sola lettura, nessuna modifica funzionale al codice. Vedi §10 per le correzioni applicate successivamente.

---

## 10. Aggiornamento — Blocco 1 risolto (2026-05-31)

I 4 problemi bloccanti del Blocco 1 sono stati corretti su questo branch:

| ID | Stato | Modifica |
|---|---|---|
| **QA-C1** | ✅ Risolto | `planning/page.tsx`: `useZoom()` spostato fuori dal condizionale in `TicketBlock` (sempre invocato, Rules of Hooks rispettate). |
| **QA-C2** | ✅ Risolto | `planning/page.tsx`: rimossa la seconda definizione (semplice) di `generateAIPlan`; mantenuta la versione con warm-up `/health` e `generandoStatus`. |
| **SEC-C1** | ✅ Risolto | `planning.py` `_batch_completion_pct()`: aggiunto filtro esplicito `Ticket.tenant_id.in_(tenant_ids)` dei piani → niente contaminazione cross-tenant. |
| **SEC-C2** | ✅ Risolto | `check_primo_livello.py`: rate limit `slowapi` (POST `segnala` 10/min, GET pubblica 30/min) + `Field(min_length=3, max_length=2000)` su `descrizione` e `max_length=120` su `operatore`. |

## 11. Aggiornamento — Blocco 2 risolto (2026-05-31)

Hardening sicurezza completato:

| ID | Stato | Modifica |
|---|---|---|
| **SEC-A3** | ✅ Risolto | Nuovo helper riusabile `require_roles()` in `security.py`; applicato a `confirm_plan`, `deauthorize_plan`, `clear_gantt` (`planning.py`) → solo `responsabile`/`superadmin`. I tecnici non possono più confermare/deautorizzare/svuotare piani. |
| **SEC-A5** | ✅ Risolto | `GeneratePlanRequest.days` → `Field(default=7, ge=1, le=90)` (bonus: `DeauthorizeRequest.reason` → `min_length=10, max_length=1000`, copre anche SEC-M1). |
| **SEC-A7** | ✅ Risolto | `diagnostic.py`: filtro `AttivitaManutenzione.tenant_id == tenant_id` sulle due query del contesto diagnostico. |
| **SEC-A4** | ✅ Risolto | `emergency.py`: filtro `tenant_id` esplicito su tutte le query `Asset`/`Impianto`/`Sito` (8 query) → sicuro anche sotto impersonation SuperAdmin. |
| **SEC-A1** | ✅ Risolto | `manuali.py`: nuovo `is_pdf()` (estensione `.pdf` + magic bytes `%PDF`) prima del parsing. |
| **SEC-A2** | ✅ Risolto | `tickets.py`: nuovo `magic_bytes_mismatch()` (HTTP 415 se il contenuto non corrisponde all'estensione); estensione ora obbligatoria (rifiuta file senza estensione). |
| **SEC-A6** | ✅ Risolto | `security.py`: `COOKIE_SECURE` default `"true"` (opt-out esplicito solo per dev locale). |

Nuovo modulo: `backend/core/file_validation.py` (signature magic-bytes per PDF/immagini/Office/zip/video, con unit-check manuale superato).

## 12. Aggiornamento — Blocco 3 risolto (2026-05-31)

UX e contratto frontend↔backend:

| ID | Stato | Modifica |
|---|---|---|
| **QA-A1** | ✅ Risolto | `planning/page.tsx`: tooltip efficiency ora usa i nomi reali (`bilanciamento_70_30`, `match_skill`, `ottimizzazione_meteo`) → niente più `undefined%`. |
| **QA-A2** | ✅ Risolto | `planning/page.tsx`: rimosso `display:"none"` dal contenitore `StoricoPiani` → storico ora visibile. |
| **QA-A3** | ✅ Risolto | `planning/types.ts`: aggiunti `sito_name`/`impianto_name` a `TicketData` (allineamento col backend). |
| **QA-M1** | ✅ Risolto | `api.ts`: `/planning/replanning` aggiunto a `SLOW_ENDPOINTS` (timeout 120s). |
| **QA-M2** | ✅ Risolto | `ReplanModal.tsx`: gestione esplicita del 503 (feature flag) con `notify.warning`. |

## 13. Aggiornamento — Blocco 4 risolto (2026-05-31)

Igiene e robustezza:

| ID | Stato | Modifica |
|---|---|---|
| **Versioni** | ✅ Allineate | `package.json` 3.1.7→3.3.0; `CLAUDE.md` 3.2.1→3.3.0. Ora coerenti con `version.ts`/`config.py` (3.3.0). |
| **Drift doc** | ✅ Corretto | `CLAUDE.md`: routing DB demo documentato come **non implementato**; dashboard descritta come event-driven (non polling 30s). |
| **SEC-M3** | ✅ Risolto | `retention_service.py`: nuova `cleanup_expired_revoked_tokens()` (>8gg) eseguita nel job giornaliero → la blacklist JTI non cresce più illimitata. |
| **SEC-M10** | ✅ Risolto | `planning.py` (2) e `assets.py` (2): i 500 non espongono più `{exc}` al client; l'eccezione è loggata server-side. |
| **SEC-M4/M5/M6** | ✅ Risolto | Bound su `feedback_analytics.days` (1-365), `report.mesi` (1-60), `QuickTicketCreate.descrizione` (max 4000). |
| **QA-B1** | ✅ Risolto | `planning.py`: `skip_engine_validation` dichiarato in `MoveTicketRequest` (niente drift silenzioso). |
| **QA-B2** | ✅ Risolto | `init_db.py`: aggiunti import `PlannerFeedback`, `AssetConditionReading` prima di `create_all()`. |

**Residui noti (non bloccanti, bassa priorità):** SEC-M2 (JWT 7gg, scelta di prodotto), SEC-M8 (caching geocoding emergency), SEC-M9 (batch limit email poller), SEC-B1/B3/B4, `RollingAnalysisPanel`/`DeferredWOPanel` non montati (dead code UI), endpoint `feedback`/`opportunistic` senza UI.

> Tutti i blocchi 1–4 dell'audit originale sono stati chiusi su questo branch.
