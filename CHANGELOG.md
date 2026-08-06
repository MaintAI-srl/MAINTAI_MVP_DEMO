# Changelog — MaintAI

Tutte le modifiche rilevanti al progetto sono documentate in questo file.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

---

## [Unreleased]

### Aggiunto
- **Livello commerciale SaaS self-service** — la base che rende gestibile in autonomia un abbonamento MaintAI (studio completo e istruzioni di prova in [`docs/SAAS_SELF_SERVICE.md`](docs/SAAS_SELF_SERVICE.md)):
  - **catalogo piani nel codice** (`backend/core/plans.py`): Start / Professional / Enterprise + prova gratuita, add-on utenti e siti, metriche a quota. Il DB conserva solo ciò che è dato del cliente (`subscriptions`), non il listino
  - **entitlement service** (`backend/services/billing/entitlement_service.py`): unico punto che decide piano, capienza e diritto di scrittura. Quote applicate prima della scrittura su `POST /utenti`, `POST /siti`, `POST /assets` e sulle chiamate AI
  - **modalità sola lettura** per abbonamenti non in regola: le letture e gli export restano sempre consentiti, così come `/billing` — un cliente moroso deve poter rientrare e portare via i propri dati
  - **provider di pagamento intercambiabili** (`providers.py`): `LocalBillingProvider` con checkout simulato (nessuna rete, nessuna chiave) e `StripeBillingProvider` pronto, attivabile con `BILLING_PROVIDER=stripe` e `pip install stripe`
  - **webhook idempotenti** (`webhook_service.py`): `UNIQUE(provider_event_id)` su `subscription_events`, così una consegna ritentata dal provider non riapplica pagamenti o disdette
  - **registrazione pubblica** (`/public/signup`), verifica email e reset password con token monouso conservati come hash SHA-256, protezione dall'enumerazione degli indirizzi, consensi versionati
  - **pagine frontend**: `/pricing`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`, `/billing/checkout` (pagamento simulato, dichiarato tale) e `/settings/billing` (stato, consumo, cambio piano, licenze, dati di fatturazione, disdetta e riattivazione)
  - **banner di stato** in cima all'app: compare solo quando c'è qualcosa da fare (prova in scadenza, pagamento fallito, sola lettura)
  - `scripts/demo_saas.py`: percorre l'intero ciclo commerciale su un DB temporaneo e stampa ogni passaggio — nessun server da avviare
  - 56 test nuovi (`test_billing_entitlements.py`, `test_billing_webhooks.py`, `test_saas_api.py`)
- Nuove variabili d'ambiente: `BILLING_PROVIDER`, `BILLING_WEBHOOK_SECRET`, `BILLING_GRACE_DAYS`, `TRIAL_DAYS`, `SELF_SERVICE_SIGNUP_ENABLED`, `APP_PUBLIC_URL`, `SMTP_URL`, `EMAIL_FROM`, `TERMS_VERSION`, `PRIVACY_VERSION`, `ACCOUNT_RETENTION_DAYS` e i price id Stripe
- **Centro di Controllo** (`/controllo`) — vista geografica di supervisione trasferita e adattata da MaintAI Alpha e potenziata con **Google Maps JS API**:
  - nuovo endpoint `GET /control-center/overview` (router `backend/api/routes/control_center.py`): per ogni sito del tenant restituisce posizione (media coordinate impianti, fallback geocoding Nominatim dell'indirizzo), stato aggregato asset (operativi/fermi/guasti), work order attivi (aperti/in corso/pianificati, breakdown) e riepilogo globale
  - nuovo modulo attivabile `control_center` (backend + frontend), voce di menu "Centro di Controllo" nella sezione Dashboard
  - mappa Google Maps con tema dark industrial, marker siti colorati per criticità (verde/ambra/rosso), marker impianti, InfoWindow con dettaglio e fit bounds automatico
  - fallback automatico su OpenStreetMap/Leaflet quando `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` non è configurata
  - KPI strip (siti critici, asset guasti, WO attivi, breakdown, tecnici disponibili), lista siti ordinata per criticità con pan/zoom su selezione, auto-refresh 60s
- Nuova variabile d'ambiente frontend opzionale: `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (limitare la key per referrer HTTP nella console Google Cloud)

### Retrocompatibilità
- Nessun cliente esistente cambia comportamento: un tenant **senza riga in `subscriptions`** resta senza limiti, senza tetto sui moduli e senza sola lettura. Il livello commerciale si attiva sottoscrivendo, non si subisce al primo deploy
- Tutti i gate commerciali sono **fail-open**: se lo stato non è leggibile (tabella non ancora migrata, DB lento) la richiesta passa — il costo di bloccare un cliente pagante è più alto di quello di lasciar passare una richiesta di troppo
- La migrazione `20260806001` non aggiunge colonne NOT NULL senza default e non tocca dati esistenti

### Modificato
- **Gate dei moduli a tre livelli**: il piano commerciale diventa un tetto fra il kill-switch globale e le decisioni del tenant (`globale ∩ piano`, poi override del cliente). Non un secondo sistema di feature flag in parallelo a quello esistente: due meccanismi indipendenti sullo stesso modulo avrebbero prodotto clienti che pagano una funzione e non la vedono. La pagina Funzionalità riceve `blocked_by_plan` accanto a `blocked_by_global`
- `frontend/app/lib/api.ts`: gli errori HTTP sono ora `ApiError` con `status` e `detail` strutturato — un 402 di quota superata porta con sé metrica, consumo e limite, invece di ridursi a `[object Object]`
- CSP frontend (`next.config.ts`): consentiti i domini Google Maps (`maps.googleapis.com`, `maps.gstatic.com`, `fonts.gstatic.com`) in `script-src`/`connect-src`/`font-src`

---

## [2.8.2] — 2026-04-19

### Allineamento Versioni
- **Sincronizzazione Globale** — Allineate tutte le versioni di Backend, Frontend, Desktop (Tauri) e Documentazione alla v2.8.2.
- **Aggiornamento Build Date** — Impostata data build al 2026-04-19 per tutti i componenti.

### v2.0-v2.8 (Sintesi)
- **Multi-tenancy reale** — Isolamento dati via `tenant_id` e routing JWT dinamico.
- **Piano AI Felix** — Nuovo motore di pianificazione ibrido (Deterministico + GPT).
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
