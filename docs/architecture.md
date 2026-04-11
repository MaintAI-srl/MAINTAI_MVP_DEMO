# ARCHITECTURE_RULES.md

## SCOPO

Questo file definisce i vincoli architetturali obbligatori di **MaintAI**.

MaintAI è un prodotto reale, già avanzato, già deployato in cloud, già multi-tenant e già composto da frontend e backend integrati.

Le modifiche architetturali devono rispettare questa realtà.

---

## PRINCIPIO ARCHITETTURALE BASE

Non trattare MaintAI come:

- un progetto locale da laboratorio
- un MVP vuoto da reinventare
- una demo scollegata dal dominio reale
- un semplice CRUD con schermate più carine

Trattalo come un sistema reale che deve:

- funzionare in cloud
- supportare più tenant
- mantenere compatibilità tra moduli
- preservare integrazioni esistenti
- crescere senza perdere coerenza
- sostenere una logica operativa reale di manutenzione

---

## REALTÀ DEL PROGETTO

Assumi sempre che tutto questo sia già vero:

- il backend esiste già
- il frontend esiste già
- il prodotto è già in cloud
- il prodotto è già multi-tenant
- esistono già moduli collegati tra loro
- il planner è una componente critica
- esistono logiche AI già avviate
- le regressioni sono un danno reale

Non agire come se stessi progettando tutto da zero.

---

## VINCOLI CLOUD

MaintAI è già deployato in cloud.

### Regole obbligatorie
- non introdurre path locali hardcoded
- non assumere un filesystem locale fisso
- non dipendere da configurazioni valide solo in sviluppo
- non usare scorciatoie che funzionano solo in localhost
- usa configurazioni compatibili con ambienti reali
- preserva l’uso di variabili d’ambiente
- mantieni il codice compatibile con deploy multipli e ambienti differenti

### Da evitare
- riferimenti assoluti a cartelle locali
- dipendenze implicite da desktop o macchina dello sviluppatore
- scritture su file temporanei non controllati
- codice fragile che funziona solo in dev
- logiche che assumono stato locale persistente senza esplicitarlo

---

## VINCOLI MULTI-TENANT

MaintAI è già multi-tenant.

### Regole obbligatorie
- ogni nuova funzione deve essere tenant-aware
- ogni query deve rispettare il tenant corrente
- ogni relazione dati deve preservare isolamento tra tenant
- ogni vista deve mostrare solo dati coerenti col tenant corretto
- nessuna modifica deve introdurre rischio di contaminazione dati tra tenant

### Da evitare
- assunzione di un cliente unico globale
- query senza filtro tenant dove necessario
- hardcode di tenant specifici
- scorciatoie single-tenant
- join o aggregazioni che mescolano dati di tenant diversi
- dashboard o planner che mostrano dati trasversali non autorizzati

### Regola critica
Se una funzione è corretta solo in contesto single-tenant, non è accettabile.

---

## COMPATIBILITÀ FRONTEND/BACKEND

MaintAI ha già un’integrazione reale tra frontend e backend.

### Regole obbligatorie
- non rinominare endpoint senza reale necessità
- non cambiare payload senza valutare impatti su frontend e servizi collegati
- non cambiare naming dei campi senza motivo forte
- non alterare contratti già usati dal frontend
- ogni estensione deve essere compatibile con il resto del sistema

### Approccio corretto
Prima di modificare:
1. analizza i contratti esistenti
2. verifica chi li usa
3. modifica nel modo più piccolo possibile
4. estendi, non demolire
5. mantieni coerenza di naming e struttura

### Regola importante
La pulizia teorica non giustifica la rottura di compatibilità.

---

## REGOLE SUL MODELLO DATI

Il modello dati attuale contiene già limiti, campi mancanti e workaround noti.

### Regola architetturale fondamentale
Non nascondere i limiti del modello.
Non fingere che i campi mancanti esistano.
Non introdurre assunzioni implicite non documentate.

Quando un campo manca ma serve alla logica:
- usare fallback esplicito
- commentare il workaround
- mantenere il codice pronto a futura evoluzione
- non mascherare il problema come se fosse già risolto

### Esempi reali di workaround già accettati nel planner
- `ticket.tipo` usato come proxy di competenza richiesta
- `tecnico_id + planned_start` usati come proxy di locked
- `created_at` o `prossima_scadenza` usati come proxy SLA
- split deciso dalla durata rispetto a `ore_giornaliere`

Questi workaround sono accettabili solo se:
- espliciti
- coerenti
- documentati
- confinati dove servono

---

## PIANI DI MANUTENZIONE

Un Piano di Manutenzione è un'entità aggregatrice indipendente (`PianoManutenzione`).
Non è una derivazione di ticket o una lista in memoria.

### Struttura e Automazione
Ogni `PianoManutenzione`:
1. Viene registrato a DB (Tabella `piani_manutenzione`).
2. Genera automaticamente un `progressivo` (sequenziale per tenant) e un `nome_codificato` (formato `PM-YYYY-NNN`) se non forniti.
3. Rappresenta il contenitore principale. I Ticket vi sono agganciati tramite FK (`piano_manutenzione_id`).
4. Supporta l'importazione diretta tramite endpoint dedicati:
   - `POST /import-pdf`: Processing AI/OCR per estrazione task da manuali tecnici.
   - `POST /import-excel`: Caricamento massivo da file CSV/XLSX con mapping flessibile.
5. Indica l'origine del ticket tramite `origine_piano` (`manuale`, `excel`, `manuale_interno_piano`).

### Regola architetturale
Operare sempre sui `PianoManutenzione` per aggregazioni globali di intervento e mai fare query libere ai ticket se il comportamento desiderato è quello di iterare un Piano programmato.

---

## ARCHITETTURA DEL PLANNER

Il planner è una componente architetturale protetta.

Non è solo frontend.
Non è solo backend.
È una logica applicativa che dipende dalla coerenza tra:

- ticket
- tecnici
- asset
- assegnazioni esistenti
- vincoli temporali
- capacità giornaliera
- ranking hard/soft rules

### Regola architetturale
La logica del planner deve stare dove può essere:
- testata
- tracciata
- spiegata
- riutilizzata
- mantenuta coerente

### Conseguenza
Non spostare la logica reale del planner nel frontend.

Il frontend può:
- visualizzare
- filtrare
- facilitare l’interazione
- mostrare esiti e motivazioni

Il frontend non deve diventare il luogo dove si inventano regole reali di assegnazione.

---

## REGOLE SUL BACKEND

Il backend deve restare coerente, stabile ed estendibile.

### Obiettivi backend
- correttezza
- stabilità
- chiarezza
- manutenibilità
- estendibilità
- coerenza col dominio manutentivo

### Regole obbligatorie
- non eliminare logica reale solo perché sembra complessa
- non fare refactor distruttivi
- non cambiare struttura dati senza valutazione impatti
- preserva compatibilità con moduli esistenti
- mantieni il backend pronto a evoluzioni future del prodotto
- centralizza le regole operative dove possibile
- preserva spiegabilità e logging

### Regola sul planner backend
Il planner deve produrre:
- assignments
- unassigned
- reason_code coerenti
- dati leggibili dal frontend
- log utile per debugging

Non deve diventare una funzione opaca e non spiegabile.

---

## REGOLE SUL FRONTEND

Il frontend deve restare un prodotto B2B professionale, non una demo estetica.

### Obiettivi frontend
- chiarezza
- usabilità
- coerenza tra moduli
- leggibilità
- credibilità operativa

### Regole obbligatorie
- non rompere il flusso dati per motivi grafici
- non introdurre componenti belli ma inutili
- non creare dashboard finte
- non usare mock al posto di dati reali senza richiesta esplicita
- mantieni layout pratici e leggibili
- visualizza correttamente stato reale, assegnazioni, frammenti e ticket non assegnati
- visualizza in modo leggibile i reason code del planner

### Regola importante sul planning UI
La UI del planning deve rappresentare il risultato della logica, non sostituirla.

---

## LOGICA DI STATO E IMMUTABILITÀ OPERATIVA

Esistono oggetti che, una volta in un certo stato, non devono essere modificati dal planner.

### Regola corrente
Un ticket con:
- `tecnico_id valorizzato`
- `planned_start valorizzato`

va considerato locked implicito.

### Conseguenza architetturale
Il sistema deve preservare la distinzione tra:
- ticket da pianificare
- ticket già pianificati
- ticket non pianificabili

Non mischiare questi stati in modo ambiguo nel codice o nella UI.

---

## GESTIONE DELLA CAPACITÀ

La capacità è oggi gestita a livello giornaliero tramite una struttura aggregata del tipo:

- `{tecnico_id: {giorno: ore_usate}}`

### Regola architetturale
Questa scelta è accettabile come base attuale, ma il sistema deve restare predisposto a futura evoluzione verso tracking a slot.

### Conseguenza
Non scrivere il codice in modo da rendere impossibile:
- passare a slot da 30 minuti
- introdurre controllo overlap più preciso
- migliorare la gestione dei gap orari

### Regola
Supportare il presente senza bloccare il futuro.

---

## SPIEGABILITÀ E OSSERVABILITÀ

Una parte critica come il planner deve essere osservabile.

### Il sistema deve poter spiegare:
- perché un ticket è stato assegnato
- perché un ticket non è stato assegnato
- quale hard rule ha escluso un candidato
- quale soft rule ha favorito un tecnico
- quando è stato applicato lo split

### Regole obbligatorie
- non eliminare logging utile
- non comprimere tutto in output illeggibili
- mantieni strutture dati chiare per debugging
- rendi i reason code consistenti e stabili

### Regola architetturale
Un planner che “funziona” ma non si può spiegare è un problema operativo, non una soluzione.

---

## TESTABILITÀ

Le componenti centrali devono essere scritte in modo da poter essere testate in modo serio.

### Obiettivo minimo
Il planner deve poter essere coperto con test unitari e test di integrazione su casi reali.

### Regole obbligatorie
- non accoppiare la logica a componenti UI
- non scrivere funzioni che richiedono ambiente locale speciale per essere testate
- isola la logica del planner in componenti testabili
- usa input/output chiari e prevedibili
- mantieni compatibilità con test in SQLite in-memory o equivalente

### Casi minimi da preservare
- happy path
- no skill
- split automatico
- capacity exceeded
- preferenza stesso impianto

---

## STRATEGIA DI MODIFICA

Quando intervieni sull’architettura, usa questo ordine:

1. correzione mirata
2. miglioramento locale
3. estensione contenuta
4. refactor cauto
5. riscrittura ampia solo se davvero inevitabile

### Regola generale
La modifica più piccola che risolve davvero il problema è quasi sempre la scelta migliore.

---

## REFACTOR: QUANDO FARLO E QUANDO NO

### Refactor accettabile se
- riduce complessità reale
- migliora chiarezza
- migliora manutenibilità
- migliora stabilità
- non rompe compatibilità
- non richiede riscritture inutili di moduli collegati
- lascia invariata o migliora la spiegabilità del planner

### Refactor non accettabile se
- è fatto solo per gusto
- cambia nomi senza valore reale
- rompe contratti esistenti
- costringe frontend e backend a rincorrersi
- distrugge parti già funzionanti
- sostituisce comportamento reale con comportamento più povero
- rende il planner meno testabile o meno trasparente

---

## CONTROLLO PRIMA DI OGNI MODIFICA

Prima di modificare una parte del sistema, verifica sempre:

1. questa parte è già usata da altri moduli?
2. questa parte è sensibile al tenant?
3. questa parte ha implicazioni cloud/deploy?
4. sto cambiando solo la presentazione o anche il contratto dati?
5. posso risolvere con una modifica più piccola?
6. sto migliorando il sistema o sto solo riscrivendo?
7. esiste rischio concreto di regressione?
8. la modifica riduce chiarezza del planner o dei reason code?
9. la modifica rende più difficile una futura evoluzione a slot o a campi reali?

---

## DA NON FARE MAI

Non fare mai queste cose:

- introdurre hardcode locali
- ignorare il multi-tenancy
- rompere contratti API con leggerezza
- rinominare strutture già in uso senza motivo forte
- creare dipendenze fragili da ambiente di sviluppo
- sostituire dati reali con finti
- fare redesign architetturali senza necessità
- trattare MaintAI come un progetto single-tenant
- spostare la logica vera del planner nel frontend
- sacrificare stabilità per “pulizia” teorica
- nascondere i workaround invece di documentarli
- omettere `Depends(get_current_tenant_id)` su qualsiasi endpoint che accede a dati di dominio
- creare record ORM senza `tenant_id=tenant_id` quando il modello ha la colonna
- usare raw SQL con variabili non sanitizzate (SQL injection)
- fare query `.all()` senza `.limit(N)` su tabelle di produzione

---

## PATTERN ARCHITETTURALI APPRESI (aggiornamento ciclo v2.0.4)

### Pattern: Endpoint tenant-safe
Ogni endpoint FastAPI che accede a dati di dominio deve seguire questo pattern:

```python
@router.get(“/risorsa/{id}”)
def get_risorsa(
    id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),   # ← obbligatorio
):
    obj = db.query(Modello).filter(
        Modello.id == id,
        Modello.tenant_id == tenant_id,   # ← obbligatorio
    ).first()
    if not obj:
        raise HTTPException(404, “Non trovato”)   # 404 = security by obscurity
    return obj
```

### Pattern: Record figlio con tenant_id
Quando un endpoint crea record derivati (es. ticket correttivo da diagnostica):

```python
child = Ticket(
    ...,
    tenant_id=tenant_id,   # ← ereditato dal parent, NON omesso
)
```

### Pattern: Query con limit
```python
# Corretto
db.query(Modello).filter(Modello.tenant_id == tid).limit(200).all()
# Sbagliato: potenziale OOM + slowdown
db.query(Modello).all()
```

### Pattern: Batch query invece di N+1
```python
# Corretto: 1 query per N oggetti
all_ids = [...]
chiusi = {row[0] for row in db.query(Model.id).filter(Model.id.in_(all_ids), Model.stato == “Chiuso”).all()}

# Sbagliato: N query in loop
for item in items:
    count = db.query(func.count(Model.id)).filter(...).scalar()
```

### Pattern: Endpoint con join — tenant_id sul join root
Quando un endpoint fa join su una tabella "foglia" (es. `AttivitaManutenzione → Asset`), il filtro tenant deve stare sulla tabella radice del join, non sulla foglia:

```python
# Corretto: filtro tenant su Asset (radice del join)
scadenze = db.query(AttivitaManutenzione).join(Asset).filter(
    Asset.tenant_id == tenant_id,   # ← tenant sul join root
    AttivitaManutenzione.prossima_scadenza <= limit,
).limit(200).all()

# Sbagliato: manca il filtro tenant → cross-tenant data leak
scadenze = db.query(AttivitaManutenzione).join(Asset).filter(
    AttivitaManutenzione.prossima_scadenza <= limit,
).all()
```

### Pattern: Record figlio con tenant_id (esteso)
Non solo i `Ticket` correttivi — TUTTI i record ORM con colonna `tenant_id` devono riceverla alla creazione:

```python
# Corretto
nuova_assenza = TecnicoAssenza(
    tecnico_id=tecnico_id,
    ...
    tenant_id=tenant_id,   # ← obbligatorio se il modello ha la colonna
)
```

### Pattern: Rate limiting endpoint AI
```python
from backend.core.rate_limiter import limiter

@router.post("/generate")
@limiter.limit("10/minute")
async def generate_plan(request: Request, ...):  # Request obbligatorio per slowapi
    ...
```
Il `limiter` è un no-op se `slowapi` non è installato — sicuro in tutti gli ambienti.

### Pattern: WebSocket con isolamento tenant
```python
# ws_manager.py — ConnectionManager per-tenant
class ConnectionManager:
    def __init__(self):
        self._connections: Dict[int, List[WebSocket]] = {}  # tenant_id → websockets

    async def broadcast_to_tenant(self, tenant_id: int, event: str, payload: dict):
        # Invia solo ai client del tenant corretto
```

### Pattern: Audit trail su creazione record
```python
@router.post("/tickets")
def create_ticket(..., payload: dict = Depends(get_current_user_payload)):
    ticket = ticket_repository.create(db, data, tenant_id)
    username = payload.get("sub") or payload.get("username")
    if username:
        ticket.created_by = username
        db.commit()
```

### Pattern: Soft Deletion
```python
# Aggiungere al modello ORM
deleted_at = Column(DateTime, nullable=True)

# Filtrare sempre nelle query lista
query = query.filter(Ticket.deleted_at.is_(None))

# Ogni nuova colonna → _ensure_columns() + migrazione Alembic
("ticket", "deleted_at", "ALTER TABLE ticket ADD COLUMN {ifne}deleted_at TIMESTAMP"),
```

### Pattern: Indice unico parziale multi-tenant (PostgreSQL)
```python
# Solo in Alembic upgrade(), protetto da dialect check
if bind.dialect.name == 'postgresql':
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_tenant_codice
        ON asset (tenant_id, codice)
        WHERE codice IS NOT NULL
    """)
```

### Pattern: Cache in-memoria con TTL
```python
_CACHE: Dict[Tuple[int, int], Tuple[float, Dict]] = {}
_TTL = 300  # secondi

def my_expensive_function(tenant_id: int, days: int) -> Dict:
    cache_key = (tenant_id, days)
    cached = _CACHE.get(cache_key)
    if cached and time.monotonic() - cached[0] < _TTL:
        return cached[1]
    result = ...  # computazione reale
    _CACHE[cache_key] = (time.monotonic(), result)
    return result
```

### Pattern: Gerarchia Skill nel Planner
```python
# skill_hierarchy: Dict[str, List[str]] — competenza superiore → competenze coperte
engine = PlannerEngine(
    ...,
    skill_hierarchy={"SENIOR_MECH": ["MECCANICO", "SALDATORE"]},
)
# Il check inline usa _skill_covers(req, tecnico.competenze, self.skill_hierarchy)
```

### Pattern: useApiQuery per data fetching frontend
```typescript
// frontend/lib/useApiQuery.ts — zero dipendenze esterne
import { useApiQuery, invalidateQueries } from "@/lib/useApiQuery";

// In un componente: sostituisce useState + useEffect + apiGet per fetch di sola lettura
const { data: manuali = [], loading, refetch } = useApiQuery<Manuale[]>("/manuali");

// Dopo una mutazione (POST/PATCH): invalida la cache per refetch automatico
invalidateQueries("/manuali");

// Bypass cache e refetch immediato
await refetch();
```
Regola: usare `useApiQuery` per tutti i GET di liste/dati statici. Mutazioni (POST/PUT/PATCH) restano con `apiPost/apiPut/apiPatch` + `invalidateQueries` dopo.

### Pattern: Skeleton loading
```tsx
import Skeleton, { SkeletonStats, SkeletonTable } from "../components/Skeleton";

// Prima del caricamento dati
{loading ? <SkeletonStats count={4} /> : <KpiCards data={dashboard} />}
{result === null ? <SkeletonTable rows={5} cols={6} /> : <DataTable data={result.items} />}

// Mai usare "Caricamento..." come testo — sostituire sempre con Skeleton
```

### Pattern: Service Worker registration (PWA)
```tsx
// In layout.tsx, dentro useEffect mount-once
useEffect(() => {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js")
      .catch(err => console.warn("[SW] non registrato:", err)); // non-critical
  }
}, []);
// sw.js usa Network-First + fallback cache per GET cacheabili
// NEVER_CACHE: auth, planning/generate, diagnostic, ws
```

### Pattern: GlobalOfflineIndicator
```tsx
// Aggiungere a layout.tsx per visibilità a tutti gli utenti
function GlobalOfflineIndicator() {
  const [isOnline, setIsOnline] = useState(true);
  useEffect(() => {
    setIsOnline(navigator.onLine);
    window.addEventListener("online", () => setIsOnline(true));
    window.addEventListener("offline", () => setIsOnline(false));
  }, []);
  if (isOnline) return null;
  return <div style={{ position: "fixed", bottom: 0, ... }}>📡 Offline</div>;
}
```

### Pattern: Endpoint statico prima del parametrico
```python
# CORRETTO: /tickets/durata-media definito PRIMA di /tickets/{ticket_id}
# altrimenti FastAPI interpreta "durata-media" come valore di ticket_id
@router.get("/tickets/durata-media")
def get_durata_media(...): ...

@router.get("/tickets/{ticket_id}")
def get_ticket(...): ...
```

### Pattern: N+1 su lista con aggregazione
```python
# Corretto: 1+1 query per N manuali
ids = [m.id for m in manuali]
counts = dict(
    db.query(AttivitaManutenzione.manuale_id, func.count(AttivitaManutenzione.id))
    .filter(AttivitaManutenzione.manuale_id.in_(ids))
    .group_by(AttivitaManutenzione.manuale_id)
    .all()
) if ids else {}
task_count = counts.get(m.id, 0)

# Sbagliato: N query in loop
task_count = db.query(AttivitaManutenzione).filter(...).count()  # dentro list comprehension
```

### Pattern: Rolling Analysis Engine (pure Python, no ORM)
```python
# backend/services/rolling_planner_engine.py
# Struttura: RollingTicketInput → run_rolling_analysis() → RollingAnalysisResult
# Nessuna dipendenza ORM — funzione pura, testabile in isolamento

### Pattern: Manual Planning Override
Le azioni manuali del planner o dell'utente (ticket portati a "Pianificato" da UI) aggiornano il DB con la flag `is_manual_plan=True` e ricalcolano server-side la data fine: `planned_finish = planned_start + durata_stimata_ore`.
I ticket manuali sono passati ai motori di planning (deterministico o AI) esclusivamente come assegnazioni "locked" (`locked_assignments`) e non vengono restituiti dalle api come varianti ri-schedulabili. Questo assicura che AI Planner rispetti in toto il planner manuale ignorandolo nelle mosse, ma consumi correttamente il monte ore.
# Il bridge ORM→Input è nel route handler (planning.py::get_rolling_analysis)

result = run_rolling_analysis(ticket_inputs, tecnici_input)
# Restituisce: analyses[], ready_count, not_ready_count, kpi{}, warnings[]
```
Proxy documentati in ogni funzione pura:
- `priority_class` ← `priorita` (Alta→P1, Media→P2, Bassa→P3) + BD override P1
- `freeze_zone` ← `planned_start` vs `datetime.now(utc)` (FROZEN<24h, PROTECTED<48h, FLEXIBLE<72h, DYNAMIC<168h)
- `pm_protected` ← `tipo=="PM"` + `prossima_scadenza` imminente o `stato=="Pianificato"`
- `insertion_score` / `disruption_cost` ← score numerici 0-100 da campi esistenti
- `materials/permits/access/job_plan ready` ← non valutabili, assunti True, documentato

### Pattern: GET /planning/rolling-analysis
```python
@router.get("/rolling-analysis")
def get_rolling_analysis(db=Depends(get_db), tenant_id=Depends(get_current_tenant_id)):
    # Carica Ticket (Aperto+Pianificato) + AttivitaManutenzione.prossima_scadenza per asset
    # Carica Tecnici attivi per skill check
    # Costruisce RollingTicketInput[] e TecnicoInput[]
    # Chiama run_rolling_analysis() — nessuna logica nel route handler
    # Restituisce analisi serializzata
```

### Pattern: POST /planning/move-ticket (chain-shift backend)
```python
class MoveTicketRequest(BaseModel):
    ticket_id: int
    new_date: Optional[str] = None          # "YYYY-MM-DD"
    new_start_hour: Optional[int] = None    # 8-17
    new_start_minute: Optional[int] = None  # 0-59
    tecnico_id: Optional[int] = None

@router.post("/planning/move-ticket")
def move_ticket(req: MoveTicketRequest, db=Depends(get_db), tenant_id=Depends(get_current_tenant_id)):
    # 1. Aggiorna planned_start/finish/tecnico_id nel DB
    # 2. Chain-shift: trova ticket dello stesso tecnico nello stesso giorno che si sovrappongono
    #    ordinati per planned_start, sposta in avanti
    # 3. Aggiorna plan_json del GeneratedPlan più recente (draft o confirmed)
    # 4. Restituisce updated_tickets[] con tutti i ticket modificati
```
**Regola**: la logica di chain-shift è backend-only. Il frontend applica update ottimistico locale e reverte in caso di errore.

### Pattern: Outlook-style Week Calendar (KanbanSettimanale)
```tsx
// Struttura layout
// Righe = ore (DAY_START=8 .. DAY_END=17, HOUR_HEIGHT=64px)
// Colonne = giorni della settimana (Lun–Ven)
// Ogni WO posizionato absolutamente: top = (startHour-8)*64 + (startMin/60)*64

// Droppable slot ID — usare || per non confondere con date ISO
const slotId = `slot||${dateStr}||${slotIndex}`;   // ✓ corretto
const slotId = `slot-${dateStr}-${slotIndex}`;      // ✗ sbagliato — ambiguo con date

// Draggable WO block
const woId = `wo||${wo.wo_id}`;

// Draggable manuale ticket
const ticketId = `ticket-${ticket.id}`;

// handleDragEnd distingue i due tipi
if (activeId.startsWith("ticket-")) { /* inserimento manuale */ }
if (activeId.startsWith("wo||")) { /* spostamento WO esistente */ }
```

### Pattern: PointerSensor con double-click
```tsx
// PointerSensor con distance constraint permette double-click senza attivare drag
const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
);
// Il drag si attiva solo dopo 8px di movimento — onClick e onDoubleClick funzionano normalmente
```

### Pattern: computeLanes() per overlap WO
```tsx
// Assegna a ogni WO un "lane index" (0, 1, 2...) basato sugli overlap temporali
// Ogni lane ha width = 100% / totalLanes
function computeLanes(wos: PlannedWO[]): Map<number, { lane: number; totalLanes: number }> {
  // Ordinare per start, assegnare lane incrementale se overlap
  // WO senza overlap → lane 0, totalLanes 1
  // 2 WO overlap → lane 0 e 1, totalLanes 2 per entrambi
}
```

---

## DIRETTIVA FINALE

Ogni scelta architetturale deve rafforzare MaintAI come prodotto reale.

Questo significa:

- più stabilità
- più coerenza
- più compatibilità
- più qualità professionale
- più sicurezza rispetto alle regressioni
- più capacità di evolvere senza rompersi
- più trasparenza nella logica del planner

Se una modifica sembra elegante ma rende il prodotto più fragile, più opaco o meno fedele al modello reale, non è una buona modifica.

---

## PATTERN ARCHITETTURALI APPRESI (ciclo v2.3.1)

### Pattern: PATCH endpoint separato dal bulk-status

Il router FastAPI registra prima le route letterali e poi quelle parametriche.
Il nuovo endpoint `PATCH /tickets/{ticket_id}` deve essere definito **dopo** il path letterale `PATCH /tickets/bulk-status`, altrimenti FastAPI interpreta `"bulk-status"` come valore di `ticket_id`.

```python
# CORRETTO
@router.patch("/tickets/bulk-status")
def bulk_update_status(...): ...

@router.patch("/tickets/{ticket_id}")
def patch_ticket(...): ...
```

Questo endpoint accetta un `TicketUpdate` parziale e non richiede tutti i campi. Differenza rispetto al PUT:
- `PUT /tickets/{id}` → aggiornamento completo, tipicamente da DetailModal
- `PATCH /tickets/{id}` → aggiornamento parziale, usato da Kanban DnD e StatusToggle inline

### Pattern: log_to_db — firma corretta

`log_to_db` crea la propria sessione DB internamente. Non riceve `db` come parametro.

```python
# CORRETTO
log_to_db("WARNING", "TICKETS", f"Ticket #{ticket_id} eliminato da {username}.", tenant_id=tenant_id)

# SBAGLIATO — causa TypeError
log_to_db(db, "WARNING", f"...")
```

### Pattern: Intercetto "Pianificato" su tutti i percorsi UI

Qualsiasi UI path che può impostare `stato = "Pianificato"` su un ticket **deve** richiedere e passare `planned_start` al backend. I percorsi da proteggere sono:
1. StatusToggle in tabella → `handleStatoChange()` centralizzato
2. Azione bulk → `bulkUpdateStatus()` centralizzato
3. DetailModal save → validazione in `handleSave()` prima della chiamata API
4. Kanban DnD → `handleDragEnd()` con modale data prima di `apiPatch`

Il backend accetta ma non impone questa regola — la validazione è UI-layer per UX.

### Pattern: Calcolo durata → planned_finish in DetailModal

Quando `durataOre` o `plannedStart` cambiano, `plannedFinish` viene ricalcolato in modo derivato:
```typescript
const newFinish = new Date(new Date(start).getTime() + hours * 3600000).toISOString();
```
`plannedFinish` non è mai editato direttamente dall'utente — è sempre derivato.

### Pattern: datetime-local e timezone — regola obbligatoria

`<input type="datetime-local">` lavora in **ora locale** del browser. Mai usare `.toISOString().slice(0, 16)` per popolare questi campi — `.toISOString()` produce UTC e crea uno sfasamento orario che fa risultare `planned_finish < planned_start` nelle timezone positive (es. UTC+2).

**Helper corretti da usare:**
```typescript
const _pad = (n: number) => String(n).padStart(2, "0");

// UTC ISO string → stringa datetime-local (ora locale)
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);   // new Date(ISO with Z) = UTC corretto
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${_pad(d.getMonth()+1)}-${_pad(d.getDate())}T${_pad(d.getHours())}:${_pad(d.getMinutes())}`;
}

// Aggiunge ore a una stringa datetime-local → nuova stringa datetime-local (ora locale)
function addHoursToDatetimeLocal(dtLocal: string, hours: number): string {
  if (!dtLocal) return "";
  const d = new Date(dtLocal);  // senza Z → locale, corretto
  const end = new Date(d.getTime() + Math.round(hours * 3600000));
  return `${end.getFullYear()}-${_pad(end.getMonth()+1)}-${_pad(end.getDate())}T${_pad(end.getHours())}:${_pad(end.getMinutes())}`;
}

// Salvataggio al backend: converte locale → UTC correttamente
body.planned_start = plannedStart ? new Date(plannedStart).toISOString() : null;
// new Date("YYYY-MM-DDTHH:mm") senza Z → trattato come locale → .toISOString() → UTC ✓
```

**Regola**: tutti i calcoli `planned_finish = planned_start + durata` nel frontend devono usare `addHoursToDatetimeLocal`, mai `.toISOString().slice(0, 16)`.

### Pattern: Creazione manuale AttivitaManutenzione (Piano Base senza PDF)

```python
att = AttivitaManutenzione(
    descrizione=data.descrizione,
    frequenza_giorni=data.frequenza_giorni,
    durata_ore=data.durata_ore,
    priorita=data.priorita,
    asset_id=data.asset_id,   # nullable
    codice=data.codice,       # nullable — identificativo opzionale utente
    origine="Manuale",        # distingue da "PDF" o "Email"
    manuale_id=None,          # nessun manuale — campo nullable in SQLAlchemy
    tenant_id=tenant_id,
)
```
Il campo `manuale_id` in `AttivitaManutenzione` è nullable anche se non dichiarato esplicitamente con `nullable=True` — in SQLAlchemy il default è nullable. Non forzare mai un manuale fittizio per creare attività manuali.

### Pattern: Endpoint DELETE con scollegamento figlio prima di eliminare

```python
# Prima di eliminare: scollega i record figlio (non eliminarli)
db.query(Ticket).filter(
    Ticket.attivita_manutenzione_id == attivita_id,
    Ticket.tenant_id == tenant_id,
).update({"attivita_manutenzione_id": None})

db.delete(att)
db.commit()
```
Questo pattern preserva la storia dei ticket pur rimuovendo l'attività-piano collegata.

### Pattern: Calendario eventi multi-tipo (scadenze + ticket)

`GET /scadenze/calendario` restituisce un array `eventi[]` unificato con campo `tipo: "scadenza" | "ticket"`.
Il frontend raggruppa per `data` (ISO date) e disegna dots colorati per giorno.
Click su giorno → mostra dettaglio nel pannello laterale con filtro per tipo.

### Pattern: NotificationPanel multi-tab

Il campanellino mostra il totale `scadenze.length + ticketsAssegnati.length`.
Due tab interne: "Scadenze PM" (da `/scadenze/imminenti?days=15`) e "Attività" (da `/tickets?stato=...`).
Il footer ha link diretti a `/scadenze` e `/ticket` via `useRouter` (non `window.location`).

### Pattern: Tree search con auto-expand

Quando una ricerca è attiva nel tree siti/impianti/asset, i nodi matchati vengono espansi automaticamente usando un set calcolato invece dello stato `expandedSiti/expandedImpianti`:
```typescript
const effectiveExpandedSiti = treeSearch
  ? new Set(filtered.map(s => s.id))
  : expandedSiti;
```
Questo evita di dover gestire l'espansione come stato separato durante la ricerca.
### Pattern: Calendario settimanale PianoAI — 7 giorni obbligatori

Il componente `KanbanSettimanale` mostra tutti e 7 i giorni della settimana (Lun-Dom).
- `getWeekDays` usa `length: 7`
- `gridTemplateColumns`: `${HOUR_LABEL_W}px repeat(7, minmax(110px, 1fr))`
- Sabato e domenica hanno sfondo distinto: column `#0b1422` vs lavorativi `#0f172a`
- Header weekend: sfondo `#162032` con label "weekend" aggiuntiva
- Il testo del periodo usa `weekDays[6]` come ultimo giorno

### Pattern: DragOverlay ad alta visibilità nel Planner

Sia `KanbanBoard` che `planning/page.tsx` usano `DragOverlay` di `@dnd-kit/core`.
- L'elemento originale durante il drag ha `opacity: 0.3` (placeholder visivo)
- Il `DragOverlay` mostra un ghost card con: colori tipo-ticket, titolo, durata, label "Rilascia nello slot desiderato"
- Il ghost card ha `transform: rotate(2deg)` e `boxShadow` amplificato per differenziarsi dalla board
- In `KanbanBoard`: `handleDragStart` salva `activeTicket` in state; `DragOverlay` renderizza `<KanbanCard isOverlay={true} />`

### Pattern: DroppableSlot con feedback "Rilascia qui"

I DroppableSlot nel calendario settimanale mostrano feedback esplicito quando `isOver=true`:
```tsx
background: isOver ? "rgba(59,130,246,0.25)" : "transparent"
outline: isOver ? "2px dashed #60a5fa" : "none"
// + label centrata "➕ Rilascia qui" visible solo quando isOver
```

### Pattern: ModalePianificaManuale con ora inizio e preset

Il modale di pianificazione manuale (da `planning/page.tsx`) include:
1. Select tecnico
2. Input date
3. Preset ore rapidi (08:00, 09:00, 10:00, 11:00, 13:00, 14:00, 15:00, 16:00)
4. Input time per ora personalizzata
5. Riepilogo automatico "08:00 → 10:00" calcolato da `oraInizio + durata_stimata_ore`
6. Badge "⚡ PIANIFICATO MANUALMENTE" con spiegazione del vincolo AI
7. Bottone Salva mostra lo slot selezionato: "✓ Pianifica — 08:00–10:00"

Il save invia `is_manual_plan: true` al backend insieme a `planned_start`/`planned_finish` con ora esatta.
