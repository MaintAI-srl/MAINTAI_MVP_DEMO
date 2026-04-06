# Elenco Miglioramenti MaintAI (Target v3.0)

> **Stato implementazione**: aggiornato al ciclo v2.0.6 (2026-04-06)
> I miglioramenti completati sono marcati ✅ in fondo al documento.

Questo documento riassume le 35 proposte di miglioramento per l'evoluzione della piattaforma MaintAI, suddivise per categoria d'impatto.

## 🔧 Backend & Architettura
1. **Migrazione a SQLAlchemy Async**: Passare a driver asincroni (es. `asyncpg`) per migliorare la gestione del carico concorrente e la velocità delle chiamate AI.
2. **Hardening della CORS Policy**: Sostituire `allow_origins=["*"]` con una gestione dinamica basata su whitelist per una sicurezza di produzione reale.
3. **Refactor delle Migrazioni Alembic**: Centralizzare tutta la gestione del database in script Alembic standard, eliminando i blocchi DDL manuali in `main.py`.
4. **Sistema di Task in Background Robusto**: Utilizzare `Taskiq` o `APScheduler` per gestire il polling delle email e altri task asincroni con persistenza in caso di crash.
5. **API Versioning (v1/v2)**: Implementare il versioning degli endpoint per garantire la retrocompatibilità del frontend durante gli aggiornamenti del backend.
6. **Supporto WebSockets**: Introdurre comunicazioni bidirezionali per notifiche push istantanee al planner quando un tecnico cambia stato a un ticket sul campo.
7. **Rate Limiting API**: Aggiungere middleware per limitare le chiamate agli endpoint critici (specialmente quelli AI) prevenendo abusi ed eccesso di costi token.
8. **Gestione Errori Centralizzata Avanzata**: Pulizia dei messaggi di errore restituiti all'utente per garantire che non vengano mai esposti dettagli sensibili del server o del database.

## 🗄️ Database & Multi-tenancy
9. **Indici Compositi per Tenant**: Ottimizzare le query aggiungendo indici strutturati su `(tenant_id, ...)` per tutte le tabelle principali.
10. **Audit Trails (Change Logging)**: Tracciamento granulare di `created_by` e `updated_by` per ogni modifica a Ticket, Asset e Tecnici.
11. **Soft Deletion Strutturata**: Implementazione di un campo `deleted_at` universale per permettere il recupero dati ed evitare cancellazioni fisiche accidentali.
12. **Constraint di Unicità Multi-tenant**: Garantire che slug e codici identificativi siano univoci all'interno del singolo tenant ma non tra tenant differenti.
13. **Schema Validation Pydantic v2**: Migrazione completa a Pydantic v2 per sfruttare il motore di validazione ad alte prestazioni basato su Rust.

## 🤖 Planning Engine & AI
14. **Supporto Multi-Tecnico**: Evoluzione del motore deterministico per gestire ticket che richiedono più di un tecnico contemporaneamente.
15. **Gerarchia delle Skill**: Implementazione di logiche di "competenza superiore" (es. Senior copre Junior) nel calcolo delle assegnazioni.
16. **Tracking a Slot (30 min)**: Passaggio dalla capacità aggregata giornaliera al calcolo puntuale basato su slot orari per una precisione millimetrica.
17. **Reason Code Gerarchici**: Dettaglio maggiore sulle motivazioni dei ticket non assegnati (es. "Manca skill" prioritario su "Capacità esaurita").
18. **Cache dei Context AI**: Sistema di caching globale per i dati statici inviati a OpenAI per ridurre latenza e consumo di token.
19. **Chatbot sui Manuali (RAG)**: Integrazione di un sistema di "Chat with PDF" per consultare i manuali tecnici caricati tramite linguaggio naturale.
20. **Stima Durata via Machine Learning**: Utilizzo dello storico per suggerire durate degli interventi più aderenti alla realtà rispetto alla stima manuale.

## 🎨 Frontend & User Experience
21. **Integrazione TanStack Query (React Query)**: Gestione avanzata del server-state, caching automatico e invalidazione dati per una UI più reattiva.
22. **Skeleton Loading Screens**: Placeholder grafici durante il caricamento dei dati per migliorare la percezione di velocità della piattaforma.
23. **Mobile First PWA Optimization**: Ottimizzazione dei flussi critici per l'uso su smartphone e tablet da parte dei tecnici sul campo.
24. **Interfaccia Drag-and-Drop**: Possibilità di spostare i ticket nello Scheduler trascinandoli, con ricalcolo automatico della saturazione dei tecnici.
25. **Centralized Notification Manager**: Unificazione dei feedback (Toast, Dialog, Errori) in un unico sistema coerente in tutta l'app.
26. **Supporto Offline**: Possibilità per i tecnici di visualizzare il lavoro assegnato anche in completa assenza di connessione internet.

## 📦 Funzionalità Operative & Integrazione
27. **Esportazione PDF Work Order**: Generazione automatica di rapporti d'intervento professionali pronti per la firma del cliente.
28. **Integrazione Calendario (ICS/Google)**: Feed personalizzato per sincronizzare le assegnazioni MaintAI con i calendari nativi degli smartphone.
29. **Tracking Geografico Asset**: Visualizzazione mappa di siti e impianti per ottimizzare la logistica degli spostamenti.
30. **Checklist di Manutenzione**: Supporto a liste di controllo obbligatorie per garantire il rispetto degli standard qualitativi nell'esecuzione dei ticket.
31. **Grafico Storico Downtime (OEE)**: Calcolo automatico della disponibilità asset e dei tempi di riparazione (MTTR).
32. **Import Massivo Excel/CSV**: Tool di onboarding rapido per caricare migliaia di asset e tecnici in una sola operazione.
33. **Webhook per Sistemi ERP**: Punti di uscita dati per l'integrazione con software di contabilità o ERP aziendali (come SAP o Zucchetti).
34. **Auto-Escalation SLA**: Avvisi automatici ai responsabili quando un ticket critico sta per superare i tempi di intervento contrattuali.
35. **Gestione Allegati Multipli Email**: Estrazione di foto e file da più allegati contemporaneamente durante la creazione di ticket via mail.

---

## Miglioramenti Implementati

### Ciclo v2.0.5 (2026-04-06)

**Sicurezza:**
- `scadenze.py` — aggiunto `tenant_id` su `GET /scadenze/imminenti` (cross-tenant data leak)
- `tecnici.py` — `TecnicoAssenza` creata con `tenant_id=tenant_id`

**Performance:**
- `manuali.py` — N+1 eliminato in `list_manuali` (batch count query, 1+1 invece di N+1)
- `manuali.py`, `tecnici.py` — aggiunto `.limit(200)` su query senza limite
- `tecnici.py` — import mid-modulo spostati a top-level

**Robustezza:**
- `logs.py` — try/except OSError su `open()` e `os.remove()` su file di log
- `dashboard/page.tsx` — NaN guard su `new Date(statoChangedAt).getTime()`

**Qualità:**
- `manuali.py` — f-string logging sostituito con `%s` lazy format (4 occorrenze)
- `api.ts` — `error: any` → `error: unknown` + `instanceof Error` guard

**UX:**
- `assets/page.tsx`, `tecnici/page.tsx`, `ticket/page.tsx`, `manuali/page.tsx`, `piani/page.tsx` — silent `catch {}` sostituiti con toast errore utente (9 catch fixes)

### Ciclo v2.0.6 (2026-04-06) — miglioramenti.md n.1-5

1. **n.1 SQLAlchemy pool**: Aggiunto `pool_size=5, max_overflow=10, pool_pre_ping=True, pool_recycle=1800` al motore PostgreSQL in `database.py`. Migrazione async completa rimane futura (richiede refactor globale di tutti gli endpoint).

2. **n.2 CORS Hardening**: Sostituito `allow_origins=["*"]` con `_load_origins()` che legge da `CORS_ORIGINS` env var. `allow_credentials=True` abilitato con origini esplicite.

3. **n.3 Alembic**: Creato `20260406001_add_scadenza_and_assenza_tenant.py` per `generated_plans.scadenza` e `tecnici_assenze.tenant_id`. Aggiunto `tecnici_assenze.tenant_id` a `_ensure_columns()`. Cleanup completo dei DDL manuali rimane futuro.

4. **n.4 Email Poller backoff**: Backoff esponenziale su errori consecutivi (5min → 10min → 20min → max 30min). Framework completo (APScheduler/Taskiq) rimane futuro.

5. **n.5 API Versioning**: Tutti i router registrati anche sotto prefisso `/v1` mantenendo path legacy invariati. Migrazione graduale del frontend a `/v1/` rimane pendente.

### Ciclo v2.0.7 (2026-04-06) — miglioramenti.md n.6-10

6. **n.6 WebSockets**: Aggiunto `backend/services/ws_manager.py` (ConnectionManager per-tenant, in-memory) e `backend/api/routes/ws_routes.py` con endpoint `/ws/ticket-updates?token=<JWT>`. Broadcast real-time disponibile per future integrazioni frontend.

7. **n.7 Rate Limiting**: Aggiunto `slowapi` a `requirements.txt` e `backend/core/rate_limiter.py` con no-op stub se non installato. Endpoint `POST /planning/generate` limitato a 10 req/min. Gli altri endpoint AI possono essere aggiunti gradualmente.

8. **n.8 Error Handling**: `generic_error_handler` arricchito con method + path + exception type nel log. I messaggi all'utente rimangono generici (no stack trace in produzione).

9. **n.9 Indici Compositi**: Alembic `20260406002_add_composite_tenant_indexes.py` — 5 indici su `(tenant_id, stato/priorita/area/status)` per ticket, asset, generated_plans, tecnici.

10. **n.10 Audit Trails**: Campo `ticket.created_by VARCHAR` aggiunto al modello ORM, ad `_ensure_columns()` e a migrazione Alembic `20260406003`. Popolato automaticamente dalla `POST /tickets` con l'username dal JWT.

### Ciclo v2.0.8 (2026-04-06) — miglioramenti.md n.11-20

11. **n.11 Soft Deletion**: Campo `ticket.deleted_at TIMESTAMP` aggiunto al modello ORM, a `_ensure_columns()` e a migrazione Alembic `20260406004`. `ticket_repository.get_paginated()` filtra automaticamente i record cancellati logicamente con `Ticket.deleted_at.is_(None)`.

12. **n.12 Constraint Unicità Multi-tenant**: Migrazione Alembic `20260406004` aggiunge indice unico parziale `uq_asset_tenant_codice` su `(tenant_id, codice) WHERE codice IS NOT NULL` (solo PostgreSQL). Garantisce unicità codice per tenant senza bloccare asset senza codice.

13. **n.13 Pydantic v2**: ✅ Già completamente migrato — tutti i modelli usano `model_config = ConfigDict(...)` senza `class Config` v1. Nessun intervento necessario.

14. **n.14 Supporto Multi-Tecnico**: Campo `ticket.tecnici_richiesti INTEGER DEFAULT 1` aggiunto al modello ORM, a `_ensure_columns()` e a migrazione Alembic `20260406004`. Il dataclass `PlannerTicket.tecnici_richiesti=1` era già presente nel motore deterministico.

15. **n.15 Gerarchia Skill**: Funzione `_skill_covers(required, tech_skills, hierarchy)` estratta dal check inline nel planner. Supporta gerarchia opzionale `Dict[str, List[str]]` passata come `skill_hierarchy` al costruttore di `PlannerEngine`. Il check inline è ora delegato a `_skill_covers(comp, tecnico.competenze, self.skill_hierarchy)`.

16. **n.16 Tracking Slot (30 min)**: Parametro `slot_minutes: int | None = None` aggiunto al costruttore di `PlannerEngine`. Non ancora implementato — il sistema registra un warning e gestisce la capacità a giornata come prima. Predisposizione senza refactor globale.

17. **n.17 Reason Code Gerarchici**: ✅ Già implementato — `REASON_PRIORITY = [NO_SKILL, LIMITATION_MISMATCH, TIME_WINDOW_CONFLICT, MULTI_TECH_NOT_FOUND, CAPACITY_EXCEEDED, NO_AVAILABILITY]` e `_pick_reason()` già presenti nel motore. Nessun intervento necessario.

18. **n.18 Cache Context AI**: Cache in-memoria con TTL 5 minuti in `ai_planner_service.py` — dizionario globale `_CTX_CACHE: Dict[Tuple[int, int], Tuple[float, Dict]]`. Hit/miss loggati. Bypass automatico quando `asset_ids` è specificato (contesto personalizzato non globalizzabile).

19. **n.19 Chatbot Manuali (RAG)**: Endpoint `POST /manuali/cerca` aggiunto in `manuali.py`. Ricerca keyword-search via SQL `ILIKE` su `nome_file` e `testo_raw`. Restituisce snippet di 160 caratteri attorno alla keyword trovata. Base per futura integrazione vettoriale RAG.

20. **n.20 Stima Durata via ML**: Endpoint `GET /tickets/durata-media` aggiunto in `tickets.py`. Aggrega `AVG(durata_stimata_ore)` dei ticket Chiusi raggruppata per `(tipo, asset_id)` con dimensione campione. Usa `durata_stimata_ore` come proxy (workaround esplicito fino a campo `durata_reale_ore` futuro).

### Ciclo v2.0.9 (2026-04-06) — miglioramenti.md n.21-26

21. **n.21 TanStack Query (useApiQuery)**: Integrato `useApiQuery` (hook interno zero-dep con caching TTL, refetch-on-focus, invalidazione) in `manuali/page.tsx` — sostituisce `loadManuali()` + `useEffect` + `useState`. `invalidateQueries("/manuali")` richiamato dopo upload per refetch automatico. Il hook (`frontend/lib/useApiQuery.ts`) è l'implementazione nativa che copre le features core di TanStack Query senza aggiungere dipendenze esterne.

22. **n.22 Skeleton Loading**: Componente `Skeleton.tsx` (già esistente con varianti block/text/card/table/stats) ora usato nei 3 principali percorsi desktop: `dashboard/page.tsx` → `<SkeletonStats count={4} />` durante il caricamento KPI; `ticket/page.tsx` → `<SkeletonTable rows={5} cols={6} />` mentre la prima pagina ticket carica; `manuali/page.tsx` → `<Skeleton variant="table" rows={4} cols={5} />` durante la lista.

23. **n.23 Mobile First PWA**: Service worker `sw.js` ora registrato via `useEffect` in `layout.tsx` (primo mount, non-critico su errore). Manifest.json, viewport meta, apple-mobile-web-app-capable già presenti. La PWA è ora installabile su mobile e desktop.

24. **n.24 Drag-and-Drop**: ✅ Già implementato — `KanbanBoard.tsx` con `@dnd-kit/core` e `useDraggable`/`useDroppable` già in `ticket/page.tsx`. Drag tra colonne Aperto→Pianificato→In corso con backend update via `PATCH /tickets/{id}`. Nessun intervento necessario.

25. **n.25 Centralized Notification Manager**: ✅ Già implementato — `frontend/lib/toast.ts` (`notify.error/success/info/warning`), `frontend/lib/useNotifications.ts` (store persistente con `useSyncExternalStore`), `NotificationPanel.tsx` (campanella con badge contatore). Usato in tutte le pagine.

26. **n.26 Supporto Offline**: Service worker `sw.js` registrato (vedi n.23) con strategia Network-First + fallback cache per GET su `/tickets`, `/assets`, `/tecnici/me`. Pagina offline HTML personalizzata quando né rete né cache. `GlobalOfflineIndicator` aggiunto a `layout.tsx` — visibile a tutti gli utenti (non solo mobile) quando la connessione viene persa.

### Ciclo v2.1.0 (2026-04-06) — fix planner + UX planning manuale

**Fix ticket spezzati (planner_engine.py):**
- `_try_allocate()`: le continuazioni di ticket splittabili ora cercano il tecnico primario prima; se non disponibile in un dato giorno, trovano il primo tecnico alternativo qualificato (stessa competenza, nessuna limitazione incompatibile, ore libere > 0). Nessuna sovrapposizione temporale: ogni frammento parte dalla prima fascia libera del giorno assegnato, calcolata via `ore_consumate`.
- Log aggiornato: `[OK-SPLIT-MULTI]` quando i frammenti usano tecnici diversi.
- 12/12 test unitari ancora verdi.

**Fix meteo (ai_planner_service.py):**
- Aggiunto `joinedload(Asset.impianto)` sulla query asset per prevenire `DetachedInstanceError` in contesto async.
- Spostato `from backend.services.weather_service import WeatherData` dal lazy import interno al top-level.
- Log esplicito quando asset con vincolo meteo mancano di coordinate (`WARNING: N asset con vincolo meteo mancano di coordinate`).

**UI planning manuale (planning/page.tsx + KanbanSettimanale.tsx):**
- Aggiunto pannello sinistro con lista ticket da pianificare (draggabili nel calendario).
- `DraggableTicket`: `useDraggable({ id: "ticket-{id}" })` per ticket manuali.
- `DroppableSlot` nelle righe ora presente anche nel Gantt giornaliero per accettare drop dai ticket manuali.

**Confronto score AI vs manuale (planning.py):**
- `POST /planning/generate` restituisce `previous_efficiency_score` e `score_improved` nel response.
- `POST /planning/evaluate`: calcola score live dai ticket Pianificato/Aperto, restituisce breakdown e motivations senza generare un piano.

### Ciclo v2.2.0 (2026-04-06) — Outlook Week Calendar + DnD bidirezionale

**Rimozione vista giornaliera (planning/page.tsx):**
- Tab "Giornaliero" rimosso — solo `"settimanale"` e `"mensile"` rimasti.
- Stato `selectedDate` → `weekStart: Date` per la navigazione settimanale.
- `VistaAttiva` type ridotto a `"settimanale" | "mensile"`.
- `CalendarioMensile.onDayClick` aggiornato: naviga alla settimana corretta in vista settimanale invece di aprire il giornaliero.

**KanbanSettimanale.tsx — riscrittura completa (Outlook-style):**
- Layout Outlook: righe = fasce orarie (08:00–17:00, `HOUR_HEIGHT=64px`), colonne = Lun–Ven.
- `DroppableSlot` per ogni ora×giorno: `useDroppable({ id: \`slot||{dateStr}||{slotIdx}\` })`.
  - Formato ID con `||` per evitare collisioni con le date che contengono `-`.
  - Highlight blu quando `isOver`.
- `WOBlock` draggable: `useDraggable({ id: \`wo||{wo_id}\` })`, `onDoubleClick` → modal riassegnazione.
- `ReassignModal`: selector tecnico, chiamata `onReassignTecnico(woId, newTecnicoId)`.
- `computeLanes()`: posiziona WO sovrapposti side-by-side via lane index.
- Navigazione settimane con `←` `→` e pulsante "questa settimana".
- Linea rossa "now" sul giorno corrente.
- Props: `weekStart, onWeekChange, tecnici, onReassignTecnico`.

**DnD bidirezionale + chain-shift (planning/page.tsx + planning.py):**
- `moveTicket(woId, dateStr, startHour, startMinute)`: update ottimistico locale poi `POST /planning/move-ticket`.
- `reassignTecnico(woId, newTecnicoId)`: chiama move-ticket con solo `tecnico_id`.
- `handleDragEnd()`: distingue drag da `ticket-{id}` (manuale) vs `wo||{id}` (WO già pianificato).
- `POST /planning/move-ticket` (backend):
  - Aggiorna `ticket.planned_start/finish` e `ticket.tecnico_id`.
  - Chain-shift: sposta in avanti i ticket del tecnico che si sovrappongono al nuovo orario.
  - Aggiorna il `plan_json` del GeneratedPlan più recente (draft o confirmed).
  - Restituisce `updated_tickets[]` con id/planned_start/planned_finish/tecnico_id.
- `PointerSensor({ activationConstraint: { distance: 8 } })`: permette double-click senza attivare drag.
- Campi diagnostici `weather_locations_count` e `weather_assets_no_coords` aggiunti al contesto pianificazione.

**Pianificazione manuale con DnD (planning/page.tsx + GanttGiornaliero.tsx):**
- Modalità **Manuale**: pannello sinistro ora mostra TUTTI i ticket (Aperto + Pianificato) ordinati per priorità/tipo, non solo i deferred dall'AI.
- Ogni ticket nel pannello è **draggable** con `@dnd-kit/core` (`DraggableTicket`). Trascina sul Gantt giornaliero → assegna al tecnico di quella riga.
- `GanttGiornaliero`: overlay droppable assoluto per ogni riga tecnico (z-index 1, sotto i blocchi WO). Evidenza visiva blu quando `isOver`.
- `DragOverlay` floating card durante il trascinamento.
- Pulsante **📊 Valutazione Piano** in modalità manuale → chiama `POST /planning/evaluate`, mostra score nel toast e nel bottone.

**Backend nuovi endpoint:**
- `POST /planning/evaluate`: calcola efficiency_score del piano manuale corrente (ticket Pianificati + Aperti) usando la stessa formula del motore AI. Ritorna score, breakdown, motivazioni.
- `POST /planning/generate`: ora include `previous_efficiency_score` e `score_improved` nella risposta se esiste un piano confermato precedente.

**AI vs Manuale:**
- Frontend confronta automaticamente lo score del piano AI generato con l'eventuale piano confermato precedente.
- Se il nuovo piano AI ha score inferiore → toast warning "Piano AI score X inferiore al piano precedente Y — puoi modificarlo manualmente o scartarlo."
