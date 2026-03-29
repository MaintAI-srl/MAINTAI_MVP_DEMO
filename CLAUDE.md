# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MaintAI is an AI-powered industrial maintenance management system targeting manufacturing, energy production, and container/bulk ports. The UI is entirely in Italian.

**Target users:**
- **Responsabile manutenzione / Planner** — pianifica, coordina, ha visione globale
- **Tecnico sul campo** — riceve il piano, esegue, usa il supporto AI per i guasti

**Core MVP features:**
1. Gestione asset con dati tecnici completi + edit in-place
2. Ticket con 5 stati (Aperto/Pianificato/In corso/Chiuso/Eliminato), filtro attivi/archivio, paginazione server-side
3. Pianificazione automatica multi-day (14 giorni) con POST /scheduler/ricalcola che aggiorna gli stati ticket
4. Sessione diagnostica AI guidata (RCA interattiva)
5. Caricamento manuale PDF → piano manutenzione automatico + pagina /piani con paginazione ed edit in-place
6. Dashboard KPI in tempo reale (polling 30s)
7. Scheduler con vista Gantt giornaliera (navigazione data) e settimanale (7-day grid per tecnico)

## Development Commands

### Backend (FastAPI + Python)
```bash
# Start development server (always from repo root)
python -m uvicorn backend.main:app --reload

# Run tests
cd backend && pytest

# Database migrations
alembic upgrade head
alembic revision --autogenerate -m "description"
```

### Frontend (Next.js + TypeScript)
```bash
cd frontend
npm run dev       # Dev server on port 3000
npm run build     # Production build
npm run lint      # ESLint
```

## Architecture

### Data Flow
```
Next.js Frontend (port 3000)
  → lib/api.ts (API_BASE = http://127.0.0.1:8000)
  → FastAPI Backend (port 8000)
  → Services layer (services/)
  → Repositories layer (repositories/)
  → SQLAlchemy ORM → SQLite (maintai.db)
                ↕
          OpenAI API (gpt-4.1-mini)
```

### Backend Structure
- `backend/main.py` — App bootstrap: `init_db()` seeds the DB on first run, registers 10 routers, configures CORS
- `backend/core/` — Config, DB session, dependency injection, custom exceptions (`AppError`), logging
- `backend/db/modelli.py` — All SQLAlchemy ORM models (single file)
- `backend/schemas/` — Pydantic request/response schemas
- `backend/repositories/` — Data access layer (Repository pattern); services call these, not ORM directly
- `backend/services/` — Business logic; `services/ai/` holds OpenAI integrations
- `backend/api/routes/` — One module per domain (assets, tickets, tecnici, scheduler, manuali, diagnostic, problem_analysis, dashboard, db, health)

### Frontend Structure
- `frontend/app/layout.tsx` — Root layout with sidebar navigation (4 sections: OVERVIEW, IMPIANTO, OPERAZIONI, INTELLIGENZA)
- `frontend/app/lib/api.ts` — Single API client utility; all fetch calls go through here
- `frontend/app/page.tsx` — Redirects `/` → `/dashboard`
- Each feature lives in its own directory under `app/` (dashboard, assets, tecnici, ticket, scheduler, manuali, problem-solving)
- `frontend/app/ticket/[ticketId]/diagnostic/` — Dynamic route for AI diagnostic chat sessions

### AI Diagnostic Flow
1. POST `/tickets/{id}/diagnostic/start` — creates a `DiagnosticSession` record with `history: []`
2. POST `/tickets/{id}/diagnostic/{session_id}/reply` — appends to history, calls OpenAI, returns structured JSON `{type: "question"|"check"|"conclusion", content, ...}`
3. Session state (history, status, root_cause) is persisted in SQLite

### Key Domain Models (`backend/db/modelli.py`)
- `Asset` — equipment/machinery
- `Tecnico` — maintenance technician (with `competenze`, `ore_giornaliere`)
- `Ticket` — maintenance request linked to an asset; key fields: `durata_stimata_ore`, `fascia_oraria`, `descrizione`
- `AttivitaManutenzione` — scheduled maintenance task (links Asset + Manuale)
- `AnalisiGuasto` — fault analysis result linked to a ticket
- `DiagnosticSession` — AI conversation state (history stored as JSON array)
- `Manuale` — uploaded technical documentation (raw text + extracted JSON)

### Two parallel data flows
- **Mock data** (`backend/data/mock_data.py`): used by `dashboard`, `scheduler`, and `assets`/`tecnici` routes — tickets here use `durata_ore`/`fascia` field names
- **DB data** (SQLite via SQLAlchemy): used by `tickets` route — tickets use `durata_stimata_ore`/`fascia_oraria` field names (matching the ORM model)

## Configuration

- Backend reads `backend/.env` for `OPENAI_API_KEY` and `OPENAI_MODEL` (currently `gpt-4.1-mini`)
- Frontend API base URL is defined in `frontend/app/lib/api.ts` via `NEXT_PUBLIC_API_BASE` env var, defaulting to `http://127.0.0.1:8000`
- CORS is configured in `backend/main.py` — update `origins` list when deploying

## Conventions

- All backend internal imports must use the `backend.` prefix (e.g. `from backend.core.database import ...`)
- AI models in use: `gpt-4.1` (problem analysis) and `gpt-4.1-mini` (diagnostic sessions, manual parsing)
- Design system: **Bold/Operativo** — navy + blu elettrico, font Barlow Condensed

## Known Issues

- There are no critical known issues.
- The duality between mock data and DB data has been reduced: dashboard, scheduler, and asset routes now all read from the SQLite DB via SQLAlchemy.
- `CORS_ORIGINS` must be set in `backend/.env` when deploying to a non-localhost environment (see `.env.example`).
