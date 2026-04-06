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
