# CLAUDE.md

Guida per Claude Code su questo repository. Aggiornato alla versione **3.2.1** (2026-05-02).

---

## ⚠️ Sicurezza — linee guida obbligatorie (leggere PRIMA di ogni modifica)

Il riferimento di sicurezza del progetto sono questi due documenti, da applicare **sempre** come base per ogni modifica:

- [`docs/SECURITY_GUIDELINES.md`](docs/SECURITY_GUIDELINES.md) — guida operativa completa (OWASP Top 10, API Security, file upload, AI/LLM, SSRF, secrets).
- [`docs/SECURITY_CHECKLIST.md`](docs/SECURITY_CHECKLIST.md) — checklist rapida da usare prima di ogni PR/deploy.

**Regole d'uso:**
- Prima di scrivere/modificare codice che tocca auth, query DB, input utente, upload, chiamate AI/esterne o config, consulta la sezione pertinente delle linee guida.
- Prima di ogni PR esegui la checklist di `docs/SECURITY_CHECKLIST.md`.
- Classifica ogni vulnerabilità trovata con la scala Critica/Alta/Media/Bassa definita nelle linee guida.

**Mappatura stack** (le guide sono scritte per Next.js/Prisma/Auth.js — qui lo stack è FastAPI/SQLAlchemy/JWT; i principi OWASP restano identici):

| Concetto nella guida | Equivalente in MaintAI |
|---|---|
| Auth.js / `auth()` | JWT in `backend/core/security.py` (`get_current_user_payload`, `require_superadmin`) |
| RBAC `requireRole()` | `require_superadmin` / check `payload["ruolo"]` + `get_current_tenant_id` |
| Prisma `findFirst({ id, tenantId })` | query SQLAlchemy con `.filter(Model.tenant_id == tenant_id)` + `check_tenant_ownership()` |
| Validazione con Zod | schema **Pydantic** (`backend/schemas/`) con `Field(min_length/max_length/...)` |
| Route Handler / Server Action | router FastAPI (`backend/api/routes/*`) con `Depends(...)` |
| `NEXT_PUBLIC_*` | env `NEXT_PUBLIC_*` nel frontend Next.js (stesso rischio: bundle client) |
| `next.config.js` security headers | header su risposte FastAPI **e** `frontend/next.config.ts` |
| Rate limiting `@upstash/ratelimit` | `slowapi` via `backend/core/rate_limiter.py` (`@limiter.limit(...)`) |
| Storage privato + signed URL | `backend/core/storage.py` (Supabase) — preferire bucket privato |
| Cifratura at-rest | `encrypt_data`/`decrypt_data` (Fernet) in `security.py` |

L'audit di sicurezza più recente è in `docs/SECURITY_AUDIT_2026-05-30.md`.

---

## Panoramica del progetto

MaintAI è un sistema di gestione manutenzione industriale AI-powered per impianti manifatturieri, energetici e portuali. L'intera UI è in **italiano**.

**Utenti target:**
- **Responsabile manutenzione / Planner** — pianifica, coordina, visione globale
- **Tecnico sul campo** — riceve il piano, esegue, usa il supporto AI per i guasti

**Funzionalità produzione attuale:**
1. Gestione Siti → Impianti → Asset con dati tecnici completi
2. Ticket con 5 stati (Aperto / Pianificato / In corso / Chiuso / Eliminato), paginazione server-side, export Excel
3. **Piano AI Felix** — motore deterministico (`PlannerEngine`) + motore GPT opzionale, viste Gantt/Kanban/Calendario, storico piani con deautorizzazione
4. Sessione diagnostica AI guidata (RCA interattiva via OpenAI)
5. Caricamento manuali PDF → estrazione automatica piano manutenzione + pagina `/piani`
6. Dashboard KPI in tempo reale (polling 30s) con grafici Recharts
7. Kanban board ticket drag-and-drop (`@dnd-kit`)
8. Integrazione Email-to-Ticket via IMAP polling (ogni 5 min)
9. Gestione tecnici con assenze e orari
10. Log di sistema persistenti in DB (`SystemLog`)
11. Multi-tenant con isolamento dati JWT

---

## Comandi sviluppo

### Backend (FastAPI + Python)
```bash
# Avvia server di sviluppo (sempre dalla root del repo)
python -m uvicorn backend.main:app --reload

# Test
pytest backend/tests/

# Migrazioni DB
alembic upgrade head
alembic revision --autogenerate -m "descrizione"
```

### Frontend (Next.js 15 + TypeScript)
```bash
cd frontend
npm run dev       # Dev su porta 3000
npm run build     # Build produzione
npm run lint      # ESLint
```

---

## Architettura

### Stack tecnico
- **Frontend**: Next.js 15 App Router, TypeScript, Tailwind v4, shadcn/ui, Recharts, @dnd-kit, sonner
- **Backend**: FastAPI, SQLAlchemy ORM, Alembic, Pydantic v2
- **DB locale**: SQLite (`maintai.db` + `demo.db` per utenti demo)
- **DB cloud**: PostgreSQL su Render
- **AI**: OpenAI `gpt-4.1` (problem analysis) e `gpt-4.1-mini` (diagnostica, parsing manuali)
- **Deploy**: Vercel (frontend) + Render (backend)

### Data flow
```
Next.js Frontend (Vercel, porta 3000 in locale)
  → frontend/app/lib/api.ts
      timeout default: 30s
      timeout endpoint AI: 120s (planning/generate, confirm, diagnostic)
  → FastAPI Backend (Render / porta 8000 in locale)
  → Services layer
  → SQLAlchemy ORM → PostgreSQL (Render) / SQLite (locale)
                ↕
          OpenAI API
          Open-Meteo API (previsioni meteo per vincoli asset)
```

### Routing DB (multi-tenant + demo)
- `get_db` in `backend/core/dependencies.py` → se JWT ha `is_demo=True` usa `demo.db` (SQLite), altrimenti PostgreSQL
- Ogni tabella ha `tenant_id` FK; le query filtrano sempre per tenant
- SuperAdmin può impersonare tenant via header `X-Tenant-Id`

### Struttura backend
```
backend/
  main.py                  — bootstrap: Alembic upgrade, init_db, email poller, 20 router
  core/
    config.py              — VERSION, OPENAI_API_KEY, init_backend()
    database.py            — engine, SessionLocal, DATABASE_URL, DEMO_DATABASE_URL
    dependencies.py        — get_db (routing demo/prod)
    security.py            — JWT decode, get_current_tenant_id, get_current_user_payload
    logger_db.py           — log_to_db(), db_info(), db_error() → scrive in SystemLog
    logging_config.py      — setup logging Python standard
    exceptions.py          — AppError, handler FastAPI
  db/
    modelli.py             — TUTTI i modelli ORM (file unico):
                             Tenant, Utente, Sito, Impianto, Asset, Tecnico,
                             Ticket, Manuale, AttivitaManutenzione, AnalisiGuasto,
                             DiagnosticSession, TecnicoAssenza, TicketAllegato,
                             EmailConfig, SystemLog, GeneratedPlan
  api/routes/              — un modulo per dominio (20 router totali)
  services/
    planner_engine.py      — motore deterministico puro (dataclass, no ORM, testabile)
    planner_engine_bridge.py — adattatore ORM→PlannerEngine→plan_json
    ai_planner_service.py  — motore GPT (Felix) + collect_planning_context + calculate_plan_efficiency
    weather_service.py     — Open-Meteo API, WeatherData
    email_poller.py        — IMAP polling ogni 5 min → crea Ticket
    pdf_service.py         — parsing PDF manuali
    ticket_service.py      — logica business ticket
    scheduler_service.py   — logica schedulazione legacy
  tests/
    test_planner_engine.py — test unitari PlannerEngine (pytest)
```

### Struttura frontend
```
frontend/app/
  layout.tsx               — shell con sidebar (nav dinamica per ruolo), topbar, theme toggle
  lib/
    api.ts                 — fetch client con JWT, timeout adattivo, retry semantics
    auth.tsx               — AuthContext, useAuth hook
    toast.ts               — notify.error/success/info/warning (sonner)
    version.ts             — VERSION corrente
  globals.css              — design system: CSS custom properties, dark/light theme via [data-theme]
  components/
    ui/                    — componenti shadcn/ui (button, badge, card, dialog, data-table...)
    KanbanBoard.tsx        — drag-and-drop con @dnd-kit
    StatusToggle.tsx       — toggle stati ticket inline
    UploadAllegati.tsx     — upload file allegati
    AssenzeModal.tsx       — gestione assenze tecnici
  dashboard/               — KPI, grafici Recharts
  ticket/                  — tabella paginata server-side, modal dettaglio, kanban
  planning/                — Piano AI Felix
    page.tsx               — pagina principale (fetch, stati, conferma, storico)
    types.ts               — TypeScript types condivisi + helpers (timeToCol, tipoStyle)
    components/
      GanttGiornaliero.tsx  — CSS grid 18 slot da 08:00 a 17:00
      KanbanSettimanale.tsx — 5 colonne Lun-Ven per tecnico
      CalendarioMensile.tsx — griglia mensile con dots colorati
      BadgeEfficienza.tsx   — conic-gradient + breakdown 5 componenti
      PannelloMotivazioni.tsx — avvisi automatici se score < 90%
      StoricoPiani.tsx      — tabella storico, accordion, modale deautorizzazione
  asset/                   — dettaglio singolo asset
  assets/                  — lista asset con filtri
  tecnici/                 — anagrafica tecnici + assenze
  manuali/                 — upload PDF + lista piani estratti
  scheduler/               — redirect a /planning (rimosso, non più usato)
  admin/
    logs/                  — visualizza SystemLog
    email/                 — configurazione IMAP
    tenants/               — gestione clienti (solo superadmin)
```

---

## Piano AI Felix — dettaglio

### Due motori intercambiabili
| Parametro `mode` | Motore | Velocità | Requisiti |
|---|---|---|---|
| `"deterministic"` | `PlannerEngine` | istantaneo | nessuno |
| `"ai"` | OpenAI GPT | 30-120s | `OPENAI_API_KEY` |
| `"auto"` (default) | deterministico se no key, AI se key presente | — | — |

### Formato `plan_json` (identico per entrambi i motori)
```json
{
  "planned_workorders": [
    {
      "wo_id": 42,
      "technician_id": 3,
      "planned_date": "2026-04-07",
      "time_slot": "08:00-10:00",
      "planned_start_time": "08:00",
      "planned_end_time": "10:00",
      "duration_hours": 2.0,
      "motivation": "...",
      "warnings": [],
      "is_continuation": false,
      "parent_wo_id": null
    }
  ],
  "deferred_workorders": [{"wo_id": 5, "reason": "..."}],
  "fermo_assets": [{"asset_id": 1, "triggered_by_wo_id": 42}],
  "global_warnings": [],
  "efficiency_score": 78,
  "efficiency_breakdown": {"copertura_backlog": 85, "utilizzo_tecnici": 70, ...},
  "efficiency_motivations": [{"componente": "...", "valore": 78, "target": 85, ...}]
}
```

### Conferma piano (`POST /planning/confirm/{id}`)
- Aggiorna **solo** ticket esistenti: `stato → "Pianificato"`, `tecnico_id`, `planned_start`, `planned_finish`
- **NON crea nuovi record Ticket**
- Asset con `fermo_on_schedule=True` → `stato → "Fermo"`
- Assegna `plan_number` progressivo per tenant (MAX+1)

### Stato Ticket → Aperto: azzera la pianificazione
Quando un ticket torna ad `"Aperto"` (via modal o toggle tabella), `planned_start` e `planned_finish` vengono settati a `null` nel DB. Il ticket torna pianificabile dal motore.

### Sincronizzazione pagina planning
- `visibilitychange`: la pagina /planning ricarica i ticket ogni volta che l'utente torna in focus
- Pulsante `↻` per refresh manuale nell'header

---

## Modello Ticket — campi chiave

| Campo | Tipo | Note |
|---|---|---|
| `stato` | String | Aperto / Pianificato / In corso / Chiuso / Eliminato |
| `tipo` | String | BD (Breakdown) / PM (Preventiva) / CM (Correttiva) |
| `priorita` | String | Alta / Media / Bassa |
| `durata_stimata_ore` | Float | usata dal planner per scheduling |
| `planned_start` | DateTime | settato alla conferma del piano (o manuale) |
| `planned_finish` | DateTime | settato alla conferma del piano (o manuale) |
| `tecnico_id` | FK | assegnato alla conferma |
| `is_continuation` | Boolean | frammento di WO splittato su più giorni |
| `parent_ticket_id` | FK | ticket padre per continuazioni |

---

## Modello GeneratedPlan — campi chiave

| Campo | Tipo | Note |
|---|---|---|
| `status` | String | draft / confirmed / deauthorized |
| `plan_number` | Integer | progressivo per tenant, assegnato alla conferma |
| `plan_json` | JSON | struttura plan_json completa |
| `confirmed_by` | String | username JWT di chi ha confermato |
| `deauthorized_by` | String | username di chi ha deautorizzato |
| `deauthorization_reason` | String | motivazione obbligatoria |

---

## Configurazione

### Variabili d'ambiente backend (`backend/.env`)
```
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
DATABASE_URL=postgresql://...          # PostgreSQL Render
DEMO_DATABASE_URL=sqlite:///demo.db    # DB demo locale
SECRET_KEY=...                         # JWT signing
CORS_ORIGINS=https://maintai.vercel.app,https://...
```

### Variabili d'ambiente frontend (Vercel)
```
NEXT_PUBLIC_API_BASE=https://maintai-v3.onrender.com
```

---

## Convenzioni di codice

- Tutti gli import backend usano il prefisso `backend.` (es. `from backend.core.database import ...`)
- I log persistenti vanno scritti con `log_to_db()` / `db_info()` / `db_error()` da `backend.core.logger_db`
- Il Python logging standard (`logger.info/error`) va **sempre** in aggiunta, non in sostituzione
- Design system frontend: dark industrial `#0a0f1e` background, `#111827` card, `#1f2937` elevated
- I colori per tipo ticket: BD=rosso `#ef4444`, PM=verde `#22c55e`, CM=ambra `#f59e0b`
- shadcn/ui Dialog: usare sempre `showCloseButton={false}` e aggiungere un singolo pulsante × custom
- Dialog z-index: `z-[9999]` per popup, `z-[9998]` per overlay (il planning usa z-index:1000)

## Migrazioni DB

Alembic è configurato con `batch_alter_table` per compatibilità SQLite.
La funzione `_ensure_columns()` in `backend/main.py` è un fallback idempotente
che aggiunge colonne mancanti via DDL diretto (usata su deploy cloud se Alembic fallisce).
Ogni deploy esegue `alembic upgrade head` automaticamente all'avvio.

---

## Known Issues / Comportamenti noti

- **Render free tier**: il backend può impiegare 30-60s per svegliarsi dal cold start. Il timeout API è 120s per gli endpoint AI e 30s per gli altri.
- **PlannerEngine skill check**: i tecnici in MaintAI usano competenze job-skill (Meccanico, Elettricista). Il bridge aggiunge automaticamente PM/CM/BD come competenze implicite a ogni tecnico attivo, così il motore deterministico non scarta i ticket per REASON_NO_SKILL.
- **`/scheduler`**: la vecchia pagina Pianificazione è un redirect a `/planning`. Non ha logica propria.
- Il `plan_json` viene salvato come `JSON` su PostgreSQL e come `TEXT` su SQLite (serializzato da SQLAlchemy automaticamente).
