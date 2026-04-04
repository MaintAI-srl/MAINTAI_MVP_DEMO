# Roadmap MaintAI
*Versione: 1.3.0 — Aggiornata al: 2026-04-04*

---

## ✅ MVP — Funzionalità Base (Completato)

- [x] Autenticazione utenti JWT con ruoli Responsabile / Tecnico
- [x] Gestione asset con edit inline e stato (in servizio / fuori servizio)
- [x] Ticket con 5 stati (Aperto → Pianificato → In corso → Chiuso / Eliminato)
- [x] Filtro attivi / archivio con paginazione server-side
- [x] Pianificazione automatica multi-day (14 giorni) — POST /scheduler/ricalcola
- [x] Gantt giornaliero + vista settimanale per tecnico
- [x] Navigazione avanti/indietro nel Gantt (giorno e settimana)
- [x] Caricamento PDF manuali → piano manutenzione AI automatico
- [x] Pagina /piani con filtri, paginazione, edit inline, genera ticket, export CSV
- [x] Dashboard KPI (ticket per stato/categoria, OEE, MTBF, downtime ticker)
- [x] Sessione diagnostica AI (RCA interattiva, GPT-4.1-mini)
- [x] Problem Analysis AI (GPT-4.1) per diagnosi rapida guasto
- [x] Gestione impianti come contenitore di asset
- [x] App mobile progressive (PWA) per tecnici in campo

---

## ✅ v1.1 — Qualità e Stabilità (Completato)

- [x] Widget meteo live in topbar (temperatura, icone, previsioni 7 giorni)
- [x] Geocoding automatico impianto → coordinate GPS → meteo locale
- [x] Integrazione meteo nello scheduler (blocco attività outdoor in maltempo)
- [x] Vincoli meteo per asset outdoor (sole richiesto, vento max, pioggia max)
- [x] Error boundary nel frontend per errori API
- [x] Gestione timeout AI con feedback utente (30 secondi)
- [x] Alembic migrations stabili + migrazioni manuali init_db.py
- [x] Split automatico ticket lunghi (>8h) in parti da max 8h

---

## ✅ v1.2 — Feature Operative (Completato)

- [x] Calendari assenze tecnici (ferie, malattia, corso) con propagazione allo scheduler
- [x] Notifiche scadenze PM imminenti (campanellina in topbar, 15 giorni)
- [x] Export piano manutenzione in CSV (compatibile Excel)
- [x] Stampa PDF piano manutenzione (stampa browser)
- [x] Analytics asset: MTBF, MTTR, Availability Score, trend guasti SVG
- [x] Upload foto / allegati ai ticket dal campo
- [x] Firma digitale tecnico su canvas touch/mouse a chiusura ticket
- [x] Database popolato: 6 tecnici, 10 impianti, 15 asset, 120 ticket storici
- [x] Accesso remoto Tailscale (CORS aperto, backend su 0.0.0.0)
- [x] Interfaccia mobile ottimizzata per smartphone (scanner ticket, foto, firma)

---

## ✅ v1.3 — Cloud & PostgreSQL (Completato)

- [x] **Migrazione PostgreSQL** — Sostituito SQLite con PostgreSQL per stabilità cloud (Render)
- [x] **Backend Deployment** — Hosting live su Render (FastAPI + Gunicorn)
- [x] **Frontend Deployment** — Hosting live su Vercel (Next.js 15)
- [x] **Auth Global Fix** — Refactoring helper API per gestione iniettata di JWT e Tenant-Id
- [x] **Database Idempotency** — Refactoring `init_db.py` per inizializzazione sicura su PostgreSQL
- [x] **Export Fix** — Download Excel/CSV protetti da autenticazione JWT

---

## 🔵 v1.4 — Breve Termine (Prossime settimane)

- [x] Ottimizzazione Dashboard KPI (MTBF, OEE reali, filtri avanzati, paginazione)
- [x] Fix performance Dashboard (isolamento re-render timer e fluidità transizioni)
- [x] Pagina /admin/logs — visualizzazione log di sistema nell'interfaccia web
- [ ] Export ticket in Excel (generazione server-side completata, manca pulizia UI)
- [ ] Badge contatore notifiche sul campanellino (numero scadenze attive)
- [ ] Aggiornamento automatico prossima_scadenza dopo chiusura ticket PM
- [ ] Pagina /profilo per cambio password e impostazioni utente
- [ ] Filtro globale "Cerca" multi-campo sulla pagina Ticket

---

## 🟡 v2.0 — Enterprise Readiness (Medio termine, 1-3 mesi)

- [ ] **Multi-tenancy reale** — Isolamento dati a livello database per aziende diverse
- [ ] Report storico asset in PDF (MTBF rolling, grafici trend, raccomandazioni)
- [ ] QR Code per asset: scansione → apertura ticket istantanea da mobile
- [ ] Commenti e note tecniche sui ticket (thread conversazione)
- [ ] Notifiche Push Web per ticket urgenti (Web Push API)
- [ ] Calendario visuale mensile PM (alternativo al Gantt)
- [ ] Integrazione ERP/MES via webhook (SAP, Infor, ecc.)

---

## 🔴 v2.1 — Scalabilità Cloud (Lungo termine, 3-6 mesi)

### ☁️ Infrastruttura
- [ ] **Containerizzazione Docker** — Deploy one-click con Docker Compose
- [ ] **Audit Log System** — Tracciabilità completa per conformità ISO 9001
- [ ] **SSO Integration** — Login Azure AD / Google Workspace

### 🤖 AI Avanzata
- [ ] **Vision AI** — Analisi foto guasto per classificazione automatica intervento
- [ ] **Privacy Redaction Layer** — Rimozione PII dai prompt prima dell'invio a OpenAI
- [ ] **Azure OpenAI** — Dati dentro perimetro cloud aziendale (GDPR enterprise)
- [ ] **Predictive Maintenance** — ML su storico ticket per predizione guasti

### 📱 Mobile Avanzato
- [ ] **Sync Offline** — Operatività in zone senza copertura, sync automatica al rientro
- [ ] **App Nativa** — React Native per iOS/Android con notifiche push native
- [ ] **Geolocalizzazione Tecnico** — Tracking posizione GPS in mappa impianto

---

## Riferimenti Tecnici

| Componente    | Tecnologia                         |
|---------------|------------------------------------|
| Frontend      | Next.js 15, React 18, TypeScript   |
| Backend       | FastAPI, Python 3.11+, Uvicorn/Gunicorn |
| Database      | **PostgreSQL** (Hosted on Render)  |
| AI Engine     | OpenAI GPT-4.1 / GPT-4.1-mini     |
| Meteo         | Open-Meteo API (gratuita)          |
| Auth          | JWT + bcrypt                       |
| Rete Remota   | Tailscale VPN (Development)        |
| Hosting       | Vercel (Frontend) + Render (Backend) |
| Mobile        | PWA (Manifest + Service Worker)    |
