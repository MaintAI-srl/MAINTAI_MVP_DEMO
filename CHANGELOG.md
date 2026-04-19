# Changelog — MaintAI

Tutte le modifiche rilevanti al progetto sono documentate in questo file.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

---

## [2.8.2] — 2026-04-19

### Allineamento Versioni
- **Sincronizzazione Globale** — Allineate tutte le versioni di Backend, Frontend, Desktop (Tauri) e Documentazione alla v2.8.2.
- **Aggiornamento Build Date** — Impostata data build al 2026-04-19 per tutti i componenti.

### v2.0-v2.8 (Sintesi)
- **Multi-tenancy reale** — Isolamento dati via `tenant_id` e routing JWT dinamico.
- **Piano AI MARCO** — Nuovo motore di pianificazione ibrido (Deterministico + GPT).
- **Desktop App** — Integrazione Tauri 2 per distribuzione MSI/Setup Windows.
- **UI Tailwind v4** — Migrazione a Tailwind v4 per prestazioni incrementate.
- **Ridisegno Ergonomica** — Status Toggle 1-click su tutte le tabelle.

---

## [1.0.0] — 2026-03-29


### Aggiunto

#### Backend (FastAPI + Python)
- **Gestione Asset** — CRUD completo per macchinari e impianti industriali con dati tecnici dettagliati ed edit in-place
- **Sistema Ticket** — 5 stati (Aperto / Pianificato / In corso / Chiuso / Eliminato), filtro attivi/archivio, paginazione server-side
- **Pianificazione automatica** — scheduler multi-day su 14 giorni (`POST /scheduler/ricalcola`) con aggiornamento automatico degli stati ticket
- **Gestione Tecnici** — anagrafica tecnici con competenze e ore giornaliere disponibili
- **Sessione Diagnostica AI** — analisi guasti guidata (RCA interattiva) basata su OpenAI GPT-4.1-mini
- **Caricamento Manuali PDF** — upload + estrazione automatica piano di manutenzione con AI
- **Dashboard KPI** — statistiche in tempo reale con polling 30s
- **Scheduler Gantt** — vista giornaliera con navigazione data e vista settimanale 7-day per tecnico
- **Gestione Impianti** — struttura gerarchica impianti/asset
- **Piani Base** — piani di manutenzione preventiva con paginazione ed edit in-place
- **Scadenze** — tracking scadenze manutenzione
- **Analisi Problemi** — analisi AI avanzata su guasti con OpenAI GPT-4.1
- **Autenticazione** — sistema login con JWT, ruoli Admin e Tecnico
- **Privacy & Anonimizzazione** — servizio di anonimizzazione dati sensibili
- **Logging applicativo** — sistema di log strutturato con endpoint dedicati
- **Endpoint `/version`** — restituisce versione, build date e stato sistema
- **Endpoint `/health`** — verifica stato backend e connettività OpenAI

#### Frontend (Next.js + TypeScript)
- **Sidebar navigazione** — 3 sezioni (Overview, Visualizzazioni, Impostazioni) con filtro per ruolo
- **Modalità Campo** — interfaccia semplificata per tecnici sul campo (`/mobile`)
- **Dashboard** — KPI in tempo reale: ticket aperti, asset critici, tecnici disponibili
- **Gestione Ticket** — lista con filtri, stato, priorità, assegnazione tecnico
- **Diagnostica AI** — chat guidata per RCA ticket (`/ticket/[id]/diagnostic`)
- **Scheduler** — Gantt giornaliero e griglia settimanale per tecnico
- **Asset** — lista asset con dettagli tecnici, analytics e edit in-place
- **Tecnici** — anagrafica con competenze e disponibilità
- **Manuali** — upload PDF e visualizzazione piano estratto
- **Piani Base** — lista piani con edit in-place
- **Impianti** — gestione struttura impianti
- **Tema Dark/Light** — toggle con persistenza localStorage
- **PWA** — Service Worker + manifest.json per installazione mobile
- **WeatherWidget** — meteo in tempo reale nella topbar
- **NotificationPanel** — pannello notifiche in tempo reale
- **Firma digitale** — acquisizione firma tecnico su tablet/mobile
- **Upload allegati** — foto e documenti su ticket
- **Versioning** — versione mostrata nella sidebar sotto il logo

### Stack Tecnico

| Layer | Tecnologia |
|-------|-----------|
| Backend | FastAPI 0.111+, Python 3.11+, SQLAlchemy 2.x, Alembic |
| Database | SQLite (sviluppo), PostgreSQL (produzione) |
| AI | OpenAI GPT-4.1 (analisi), GPT-4.1-mini (diagnostica, manuali) |
| Frontend | Next.js 15+, React 19+, TypeScript, CSS Modules |
| Storage | File system locale / Supabase Storage (cloud) |
| Deploy | Render (backend), Vercel (frontend) |
| Auth | JWT con ruoli (Admin, Tecnico) |

### Deployment

- **Backend:** `https://maintai-v3.onrender.com`
- **Frontend:** `https://maintai-frontend.vercel.app`

---

## Note

- Il duale mock data / DB data è stato risolto: dashboard, scheduler e asset leggono tutti da SQLite via SQLAlchemy.
- I `CORS_ORIGINS` devono essere impostati in `backend/.env` per deploy non-localhost.
