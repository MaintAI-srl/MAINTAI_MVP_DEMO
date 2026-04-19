# Roadmap MaintAI
*Versione: 2.8.2 — Aggiornata al: 2026-04-19*

---

## ✅ MVP — Funzionalità Base (Completato)

- [x] Autenticazione utenti JWT con ruoli Responsabile / Tecnico
- [x] Gestione asset con edit inline e stato (in servizio / fuori servizio)
- [x] Ticket con 5 stati (Aperto → Pianificato → In corso → Chiuso / Eliminato)
- [x] Filtro attivi / archivio con paginazione server-side
- [x] Pianificazione automatica multi-day (14 giorni) — POST /scheduler/ricalcola
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

---

## ✅ v1.3 — Cloud & Infrastruttura (Completato)

- [x] **Migrazione PostgreSQL** — Sostituito SQLite con PostgreSQL per stabilità cloud (Render)
- [x] **Backend Deployment** — Hosting live su Render (FastAPI + Gunicorn)
- [x] **Frontend Deployment** — Hosting live su Vercel (Next.js 15)
- [x] **Auth Global Fix** — Refactoring helper API per gestione iniettata di JWT e Tenant-Id
- [x] **Database Idempotency** — Refactoring `init_db.py` per inizializzazione sicura su PostgreSQL

---

## ✅ v1.4 — UI Ergonomics & Unified Scheduler (Maggio 2026) (Completato)

- [x] **Ridisegno Ergonomica Status**: Eliminati vecchi dropdown, sostituiti con Status Toggle (1-click action) in tutte le interfacce per velocizzare il lavoro.
- [x] **Cruscotto di Pianificazione Unificato**: Modulo Scheduler e Modulo Pianificazione AI accorpati. Navigazione ibrida (Manuale/AI) pilotata dal un Toggle switch superiore.
- [x] **Interfaccia Master in Stile Dash Excel**: Layout comprensivo di Status Backlog, KPI Efficienza, Gantt Orari, Piani Giornalieri, Settimanali e Mensili accorpati in un'unica visuale per il planner.
- [x] **Gestione Visuale**: Indicatori warning globali, indicazione visiva split (>8h).
- [x] **Dashboard Analysis**: MTBF e OEE in real-time interattivi per singoli asset con grafici live.
- [x] **Sanificazione Progetto**: Rimozione totale script test orfani, log temporanei e vecchi mock files JSON per un repository pulito, scalabile e senza debto tecnico.

---

## 🔵 v1.5 — Breve Termine (Prossimi Target)

- [ ] Completamento Pagina `/profilo` per cambio password e preferenze singole dell'utente.
- [ ] Export finale ticket interattivi in Excel lato Frontend.
- [ ] Implementazione "Global Search" multi-campo sulla pagina Ticket (Ricerca per Titolo, Asset, Tecnico in un colpo solo).
- [ ] Badge contatore sull'icona notifiche campanellino (topbar) per richiamare attenzione visiva al rinnovo PM.

---

## 🟡 v2.0 — Enterprise Readiness & Workflow (Medio termine, 1-3 mesi)

- [ ] **Multi-tenancy reale**: Isolamento dati a livello database per gestire contemporaneamente clienti, branch o plant diversi sotto un unico backend in SaaS.
- [ ] **Thread di Commenti**: Chat collaborativa incapsulata nei singoli Ticket per comunicazioni dirette Responsabile <-> Tecnico.
- [ ] **Notifiche Push Web**: Dispatch via Web Push API per notificare ai tecnici in campo un BD (Guasto Critico) direttamente sullo smartphone aggirando le email.
- [ ] **QR Code Scanning Reale**: Generazione PDF di QRCode per ogni asset. Il tecnico inquadra il codice da cell e si apre automaticamente la maschera "Nuovo Ticket" pre-compilata.
- [ ] **Report AI PDF**: Autogenerazione mensile di report per la dirigenza con andamenti, grafici storici, raccomandazioni AI su quali macchinari sostituire per abbassare MTBF.
- [ ] **WebHooks & Integrazioni ERP**: Connettori SAP via REST/WebHook per inviare flussi di scarico magazzino consumabili.

---

## 🔴 v3.0 — Innovazione, AI & Scalabilità Cloud (Lungo termine, 3-6 mesi)

### 🤖 AI e Automazione Avanzata
- [ ] **Extraction Pezzi di Ricambio via NLP**: L'AI legge le note finali del tecnico dal ticket e decurta automaticamente l'inventario dei pezzi di ricambio menzionati dal magazzino virtuale.
- [ ] **Predictive Maintenance Machine Learning**: Sistema isolato su cloud che analizza temperature, vibrazioni e log storici (o sensori IoT reali) per avviare *Ticket Predittivi* pre-rottura.
- [ ] **Voice-To-Ticket**: Integrazione Whisper AI su app mobile. Il Tecnico detta la natura del guasto e il sistema auto-compila form lunghi (causa radice, lavoro svolto, materiali usati).
- [ ] **Vision AI**: Analisi di una foto scattata dall'app per suggerire in automatico tag e root cause visibili (es. quadro elettrico manomesso, perdita olio visibile).

### ☁️ Infrastruttura & Operatività Estrema
- [ ] **Containerizzazione Docker**: Deploy one-click enterprise della piattaforma completa per aziende in modalità on-premise isolata (Docker Compose).
- [ ] **SSO Integration**: Login Azure AD / Google Workspace per sicurezza aziendale.
- [ ] **Offline-First PWA Storage Sync**: IndexedDB e architettura a code "ServiceWorker" per far lavorare il tecnico nei sottoscala o cantine fuori-rete. Al recupero linea (Wi-Fi), il payload viene svuotato asincronamente verso il server. 
- [ ] **Geolocalizzazione GPS e Dispatching Map**: Una mappa interattiva (Google Maps / Leaflet) per visualizzare ticket territoriali sparsi a livello cittadino e suggerire le roadmap stradali migliori nel giorno. 

---

## Riferimenti Tecnici

| Componente    | Tecnologia                         |
|---------------|------------------------------------|
| Frontend      | Next.js 15, React 18, TypeScript   |
| Backend       | FastAPI, Python 3.11+, Gunicorn    |
| Database      | **PostgreSQL** (Hosted on Render)  |
| AI Engine     | OpenAI GPT-4.1 / GPT-4.1-mini     |
| Rete / Sync   | HTTPS, JWT Auth, Service Worker    |
| Hosting       | Vercel (Front) + Render (Back)     |
