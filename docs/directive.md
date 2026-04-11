# DIRECTIVE.md

## RUOLO

Stai lavorando su **MaintAI**, una piattaforma cloud e multi-tenant per la gestione operativa della manutenzione.

MaintAI non è:

- un prototipo da zero
- una demo finta
- un gestionale generico da ticketing
- un progetto scolastico CRUD
- una dashboard decorativa con AI incollata sopra

MaintAI è un prodotto reale, già avanzato, con architettura esistente, frontend e backend integrati, logiche operative già presenti e vincoli reali di dominio.

Il tuo compito è **migliorare, estendere, rifinire e stabilizzare** il prodotto **senza rompere ciò che già funziona**.

---

## MISSIONE PRINCIPALE

Ogni modifica deve ottimizzare per:

1. **stabilità**
2. **compatibilità**
3. **utilità operativa**
4. **coerenza con il dominio manutentivo**
5. **qualità professionale del prodotto**
6. **spiegabilità della logica**
7. **sicurezza rispetto alle regressioni**

Se una modifica rende il codice apparentemente più semplice ma rende il prodotto meno vero, meno utile, meno trasparente o meno robusto, allora quella modifica è sbagliata.

---

## REALTÀ DEL PROGETTO

Devi assumere come veri i seguenti punti:

- il prodotto è già deployato in **cloud**
- il prodotto supporta già il **multi-tenancy**
- esiste già una struttura funzionante frontend/backend
- i moduli principali esistono già
- il planner è una componente critica del valore del prodotto
- il database reale ha alcuni campi mancanti rispetto alla specifica ideale
- alcuni comportamenti si basano su workaround espliciti
- le regressioni hanno costo reale e non sono accettabili come effetto collaterale normale

Non devi comportarti come se stessi progettando MaintAI da zero.

---

## IDENTITÀ DEL PRODOTTO

MaintAI è una piattaforma progettata per l’uso reale in contesti come:

- aziende di service manutentivo
- facility management
- manutenzione industriale
- ambienti tecnici e operativi con vincoli reali

Unisce in un unico sistema:

- gestione asset
- gestione tecnici
- gestione ticket di manutenzione
- planning operativo
- supporto AI al problem solving
- parsing di manuali tecnici
- futura automazione di flussi operativi

### Motto del prodotto
**Fatto da manutentori per manutentori**

---

## PRINCIPIO GUIDA ASSOLUTO

Non distruggere logiche vere per sostituirle con versioni più semplici ma peggiori.

Questo vale soprattutto per:

- planner
- assegnazioni
- vincoli tecnici
- compatibilità frontend/backend
- logica multi-tenant
- gestione dei ticket già pianificati
- output spiegabili e reason code

Se il sistema oggi ha una complessità reale, non devi cancellarla solo per far sembrare il codice più elegante.

---

## ORDINE DI LETTURA OBBLIGATORIO

Quando lavori su MaintAI, considera questo file come regola generale.

Per le aree specifiche devi anche rispettare:

1. `ARCHITECTURE_RULES.md`
2. `PLANNING_GUARDRAILS.md`

### Regola
Se il task tocca il planner, le regole di `PLANNING_GUARDRAILS.md` hanno priorità operativa su ogni semplificazione generica.

Se il task tocca cloud, multi-tenant, API, contratti dati o struttura dei moduli, le regole di `ARCHITECTURE_RULES.md` sono vincolanti.

---

## REGOLE NON NEGOZIABILI

### 1. Non rompere funzioni già operative
Se qualcosa funziona già, va preservato a meno che il task non richieda esplicitamente di cambiarlo.

### 2. Non sostituire logiche reali con placeholder
Non trasformare funzioni reali in mock, dati finti, card statiche o versioni semplificate prive di logica operativa.

### 3. Non inventare dati che il modello non possiede
Se il database non contiene un campo richiesto dalla specifica ideale, devi:
- dichiararlo
- usare un workaround esplicito se già previsto
- non fingere che il dato esista davvero

### 4. Preserva la compatibilità frontend/backend
Non rinominare campi, endpoint, payload o strutture senza una reale necessità e senza valutare gli impatti.

### 5. Rispetta sempre il multi-tenancy
Ogni nuova logica deve essere sicura rispetto ai tenant e non deve mescolare dati.

### 6. Rispetta il contesto cloud
Non introdurre assunzioni valide solo in locale, path hardcoded o comportamenti fragili dipendenti dall’ambiente.

### 7. Il planner è un’area protetta
Non banalizzare, isolare o svuotare la logica del planner.

### 8. Le modifiche UI non devono cambiare il comportamento salvo richiesta esplicita
Se il task riguarda stile o visualizzazione, deve restare un task di presentazione.

### 9. Fai refactor solo se è giustificato
Refactor solo se migliora davvero chiarezza, stabilità, manutenibilità, estendibilità o testabilità senza rompere integrazioni.

### 10. Parti sempre dalla struttura esistente
Non ricostruire moduli interi se basta una correzione mirata o una estensione coerente.

### 11. Il Piano di Manutenzione è Persistente e Automatico
Il termine "Piano di Manutenzione" fa riferimento alla tabella `piani_manutenzione`. Usa questa vera entità a database. Il sistema deve autogenerare progressivi e nomi codificati (es. PM-2026-001) se non forniti. I ticket creati via import (PDF AI/OCR o Excel) devono essere agganciati al piano con `origine_piano` coerente.

---

## COSA MAINTAI NON DEVE DIVENTARE

Non portare MaintAI verso uno di questi esiti:

- dashboard SaaS generica
- helpdesk IT travestito da manutenzione
- board visuale senza logica reale
- motore AI che genera testo vago
- planner bello ma falso
- frontend che sostituisce il backend nelle regole operative
- architettura teoricamente pulita ma scollegata dal modello reale

---

## REGOLE SUL MODELLO REALE

MaintAI usa un modello dati reale che non coincide ancora perfettamente con la specifica ideale.

### Regola obbligatoria
Ogni differenza tra specifica ideale e DB reale deve essere trattata con onestà tecnica.

### Sono ammessi solo questi comportamenti:
- mapping fedele dei campi esistenti
- fallback espliciti
- workaround documentati
- predisposizione a evoluzioni future senza fingere che esistano già

### Non sono ammessi:
- campi inventati
- scorciatoie nascoste
- assunzioni implicite non documentate
- “simulazioni” di dati inesistenti spacciate per modello reale

---

## REGOLE SU CLOUD E MULTI-TENANT

Per ogni modifica devi assumere che il sistema debba continuare a funzionare in contesto:

- cloud
- multi-tenant
- integrato
- già deployato

### Quindi:
- non hardcodare percorsi locali
- non assumere un solo cliente globale
- non ignorare filtri tenant
- non creare dipendenze che funzionano
- **FAIL-CLOSED SECURITY**: I middleware di sicurezza (CSRF, Auth) devono sempre negare l'accesso se mancano gli header critici (es. Origin/Referer su POST).
- **EDGE MASKING**: Ogni dato in ingresso da fonti non controllate (Email, Webhook) deve essere anonimizzato IMMEDIATAMENTE prima della persistenza.
- **JTI REVOCATION**: Il logout non deve solo cancellare il cookie lato client, ma invalidare il `jti` sul DB.

Se una modifica funziona bene solo in locale o in single-tenant, non è accettabile.

---

## REGOLE SUL PLANNER

Il planner è il cuore operativo di MaintAI e va trattato come motore logico, non come semplice UI.

### Il planner deve restare collegato a:
- ticket
- tecnici
- disponibilità
- capacità giornaliera
- skill
- limitazioni
- priorità
- impianti
- reason code
- split automatico
- ticket già assegnati da non toccare

### Regola assoluta
Non spostare la logica vera del planner nel frontend.

Il frontend può:
- rappresentare
- filtrare
- facilitare la lettura
- mostrare spiegazioni

La logica di assegnazione reale deve restare lato backend o comunque in uno strato logico testabile e coerente.

### Regola sui locked
Un ticket già assegnato secondo la convenzione attuale non deve essere ripianificato.

### Regola sui workaround del planner
I workaround già accettati devono restare:
- espliciti
- coerenti
- documentati
- facili da sostituire in futuro con campi reali

---

## REGOLE SU BACKEND

Il backend deve restare:

- corretto
- stabile
- leggibile
- manutenibile
- estendibile
- coerente col dominio reale

### Quando modifichi il backend:
- preserva compatibilità dei contratti
- non eliminare logica reale perché sembra complessa
- non fare refactor distruttivi
- non alterare strutture dati senza valutare impatti
- mantieni output spiegabili
- mantieni reason code consistenti
- mantieni il planner testabile

---

## REGOLE SU FRONTEND

Il frontend deve sembrare e funzionare come un prodotto B2B operativo vero.

### Deve privilegiare:
- chiarezza
- leggibilità
- coerenza
- usabilità reale
- rappresentazione onesta dei dati
- comprensione rapida dello stato operativo

### Deve evitare:
- widget decorativi
- dashboard finte
- redesign superficiali
- componenti “marketing” vuoti
- UI che nasconde o distorce la logica reale del planner
- uso di mock dove servono dati veri

### Regola importante
La UI deve rappresentare la verità operativa del sistema, non una sua versione semplificata per fare scena.

---

## REGOLE SU SPIEGABILITÀ E DEBUG

MaintAI deve restare comprensibile e analizzabile.

Ogni logica importante, soprattutto nel planner, deve poter spiegare:

- perché un ticket è stato assegnato
- perché è rimasto non assegnato
- quale regola ha escluso un candidato
- quale criterio ha favorito un tecnico
- quando è stato fatto split
- quali workaround sono stati applicati

### Regola
Non trasformare il prodotto in una black box elegante ma muta.

---

## REGOLE SU TESTABILITÀ

Le componenti centrali devono poter essere testate in modo serio.

### In particolare:
- la logica planner non deve dipendere dalla UI
- l’input/output del planner deve essere chiaro
- i reason code devono essere stabili
- i casi base devono poter essere tradotti in test automatici
- il codice deve poter lavorare con ambienti di test realisti, incluso SQLite in-memory dove previsto

### Casi minimi da preservare
- happy path
- no skill
- split automatico
- capacity exceeded
- preferenza stesso impianto

---

## COME LAVORARE QUANDO RICEVI UN TASK

Prima di modificare qualcosa, verifica sempre:

1. questa parte funziona già?
2. riguarda stile, logica o architettura?
3. quali moduli dipendono da questa parte?
4. il task tocca planner, multi-tenancy, cloud o contratti dati?
5. posso risolvere con una modifica più piccola?
6. sto migliorando il sistema o lo sto solo riscrivendo?
7. rischio di introdurre regressioni?
8. sto nascondendo un limite reale del modello invece di gestirlo in modo esplicito?
9. la modifica riduce trasparenza, testabilità o spiegabilità?

---

## STRATEGIA DI MODIFICA CONSENTITA

Usa questo ordine di preferenza:

1. correzione mirata
2. miglioramento locale
3. estensione contenuta
4. refactor prudente
5. riscrittura ampia solo se davvero inevitabile

### Regola
La modifica più piccola che risolve davvero il problema è quasi sempre la scelta migliore.

---

## COSE DA NON FARE

Non fare mai queste cose:

- sostituire logiche funzionanti con mock
- appiattire logiche complesse in falsa semplicità
- inventare campi non presenti nel DB
- rinominare strutture già in uso senza motivo forte
- rompere API con leggerezza
- assumere single-tenant dove il sistema è multi-tenant
- introdurre hardcode locali
- spostare la logica vera del planner nel frontend
- eliminare reason code o logging utile
- trattare `planned_start` e `planned_finish` come input se sono output
- confondere ticket da pianificare con ticket già assegnati
- sacrificare stabilità per pulizia teorica
- usare `datetime.utcnow()` — usa sempre `datetime.now(timezone.utc)` (deprecato in Python 3.12+)
- usare `class Config` Pydantic v1 — usa `model_config = ConfigDict(...)` (Pydantic v2)
- passare Python `True` come argomento a `.filter()` SQLAlchemy — usa `.filter()` condizionale
- fare import lazy dentro funzioni salvo casi eccezionali — metti sempre gli import a top-level
- usare `f"SELECT ... {var}"` o f-string con SQL raw — usa parametri binding o allowlist
- calcolare completion_pct in loop N+1 — usa batch query con set lookup O(1)
- usare f-string nei log (`logger.info(f"...")`) — usa sempre `%s` lazy formatting (`logger.info("...", arg)`)
- usare apiPost con FormData nel frontend — apiPost imposta application/json mandando in crash il parser multipart; usare apiUpload
- omettere endpoint di importazione pesanti (AI/OCR) da SLOW_ENDPOINTS — causa timeout (504/AbortError) su file grandi
- creare record ORM figli senza `tenant_id` (es. `TecnicoAssenza`) quando il modello ha la colonna
- omettere `tenant_id` su endpoint che fanno join su Asset/AttivitaManutenzione — il filtro va sul join root
- lasciare catch vuoti (`catch {}` o `.catch(() => {})`) nel frontend — mostrare sempre un toast all'utente
- fare `new Date(str).getTime()` senza validare che il risultato non sia `NaN` — aggiungere `if (isNaN(ts)) return "—"`
- usare `allow_origins=["*"]` in produzione — leggere sempre da `CORS_ORIGINS` env var tramite `_load_origins()`
- dimenticare il filtro `Ticket.deleted_at.is_(None)` nelle query lista — i soft-deleted devono essere invisibili
- registrare il service worker a ogni render — usare `useEffect(fn, [])` con mount-once
- lasciare il service worker `sw.js` senza registrazione — non viene mai attivato senza `navigator.serviceWorker.register()`
- mostrare "Caricamento..." come testo — usare `<Skeleton>` per una UX professionale
- usare `loadDati()` + `useState` + `useEffect` quando `useApiQuery` copre il pattern con caching automatico
- definire un endpoint statico DOPO uno parametrico con lo stesso prefisso (es. `/tickets/durata-media` dopo `/tickets/{id}`) — FastAPI lo intercetterebbe come parametro
- omettere il bypass cache quando il contesto è personalizzato (asset_ids specificato) — cache errata causa cross-contesto data
- usare gerarchia skill hardcoded inline — passarla come parametro `skill_hierarchy` al costruttore di `PlannerEngine`
- aggiungere nuove colonne al DB senza creare una migrazione Alembic — ogni nuova colonna deve avere sia la migrazione sia il fallback in `_ensure_columns()`
- usare `-` come separatore nei Droppable ID quando il valore può contenere `-` (es. date ISO) — usare `||` come separatore per evitare collisioni: `slot||2026-04-07||3`
- spostare logica di chain-shift nel frontend — il ricalcolo degli orari dei ticket sovrapposti va fatto nel backend (POST /planning/move-ticket)
- fare DnD su calendario planning senza aggiornare plan_json — ogni move via UI deve persistere planned_start/finish nel DB e riscrivere plan_json del piano attivo
- usare `PointerSensor` senza `activationConstraint: { distance: 8 }` quando si vuole preservare il double-click — senza la soglia di attivazione il drag parte subito e intercetta onDoubleClick
- implementare `rolling_planner_engine.py` senza documentare i proxy sui campi DB mancanti — ogni campo derivato da campo esistente deve avere un commento esplicito con la direttiva "Workaround: campo non presente nel DB, sostituire con campo reale quando disponibile"
- invocare hook React dopo un early return (`if (loading) return ...`) — tutti gli hook (useState, useMemo, useSensors, useCallback) devono stare prima di qualsiasi early return
- schedulare ticket `NOT_READY` — un ticket senza durata credibile o senza tecnici qualificati non deve essere inserito nel piano esecutivo; va esposto in backlog con bottleneck
- creare engine PostgreSQL senza `pool_pre_ping=True` e `pool_recycle` — le connessioni stale causano errori silenziosi dopo idle prolungato
- aggiungere endpoint AI senza rate limiting — usare `@limiter.limit("N/minute")` da `backend/core/rate_limiter.py`
- creare nuovi campi audit (`created_by`) senza popolarli nel route handler che crea il record
- aggiungere WebSocket routing senza `ConnectionManager` isolato per tenant — il WS manager deve mantenere isolamento tra tenant
- consentire cambio stato ticket a "Pianificato" senza richiedere `planned_start` — il frontend deve intercettare con un modal di selezione data prima di inviare la PUT/PATCH; senza data lo stato non cambia
- eliminare ticket senza conferma + motivo obbligatorio (`eliminazione_note` ≥ 5 char) — il motivo va loggato via `log_to_db` sul backend; il pulsante rimane disabilitato finché il campo è vuoto
- implementare drag & drop Kanban che chiama un endpoint inesistente — il KanbanBoard deve puntare a `PATCH /tickets/{id}` (endpoint dedicato, separato da bulk-status); "Pianificato" intercettato con modal data prima della call API
- omettere `planned_start`/`planned_finish` dal payload `BulkStatusUpdate` quando lo stato target è "Pianificato" — estendere il modello Pydantic e il handler per accettare e propagare le date su update massivi
- creare `AttivitaManutenzione` senza `tenant_id` o con `manuale_id` non-null obbligatorio quando si crea manualmente — il campo `manuale_id` è nullable e la creazione manuale imposta `origine="Manuale"` e `manuale_id=None`
- aggiungere campi nuovi a modelli ORM senza aggiungere l'entry corrispondente in `_ensure_columns()` di `main.py` — ogni nuova colonna deve avere sia il fallback DDL sia la migrazione Alembic
- definire endpoint DELETE su una risorsa senza scollegare prima i record figlio — verificare sempre le relazioni (es. ticket collegati ad AttivitaManutenzione) e gestirle prima della delete
- usare join INNER quando la relazione è nullable (es. `AttivitaManutenzione.asset_id` nullable) — usare `join(..., isouter=True)` per non escludere record senza relazione
- caricare ticket da tab notifiche senza distinguere tra scadenze PM e ticket operativi attivi — il NotificationPanel usa due tab separate (Scadenze / Attività) con polling indipendente
- navigare alla pagina scadenze senza usare `router.push("/scadenze")` da `NotificationPanel` — usare `useRouter` di next/navigation (non window.location) per navigazione SPA
- usare `.toISOString().slice(0, 16)` per popolare un `<input type="datetime-local">` — `.toISOString()` restituisce UTC, ma il campo mostra/riceve ora locale; usare i getter locali (`getFullYear`, `getMonth`, `getDate`, `getHours`, `getMinutes`) o un helper `toDatetimeLocal()` dedicato
- calcolare `planned_finish = planned_start + durata` con `new Date(str).toISOString()` — produrrebbe un orario UTC che il browser mostra come ora locale errata; usare `addHoursToDatetimeLocal(str, ore)` che lavora interamente in ora locale senza conversioni UTC
- implementare il calendario settimanale del planner con sole 5 colonne (Lun-Ven) — il planner settimanale deve mostrare tutti e 7 i giorni; il sabato e la domenica devono avere sfondo visivamente distinto (`#0b1422` vs `#0f172a`) ma essere pienamente operativi
- usare DragOverlay vuoto o assente durante il drag nel Kanban o nel planner — quando un elemento è trascinato deve essere visibile un ghost card (DragOverlay) chiaramente leggibile con colori tipo-ticket, titolo e durata; l'elemento originale deve avere opacity ridotta (≤0.3) per indicare il "placeholder"
- lasciare i DroppableSlot senza feedback visivo chiaro — quando `isOver=true` usare sfondo `rgba(59,130,246,0.25)` + outline `2px dashed #60a5fa` + label "Rilascia qui"
- implementare ModalePianificaManuale con solo campo data senza ora — il modale di pianificazione manuale deve includere: tecnico, data, ora inizio (con preset 08:00–16:00), durata auto-calcolata, e badge "PIANIFICATO MANUALMENTE"; il salvataggio deve inviare `is_manual_plan: true` al backend

---

## CHECKLIST DI SICUREZZA PER OGNI NUOVO ENDPOINT

Prima di creare o modificare un endpoint FastAPI, verificare:

1. **tenant_id**: il Depends(get_current_tenant_id) è presente?
2. **filtro tenant**: ogni query DB filtra per `Model.tenant_id == tenant_id`?
3. **nuovi record**: i nuovi oggetti ORM includono `tenant_id=tenant_id`?
4. **auth**: l'endpoint richiede autenticazione appropriata (token JWT o require_superadmin)?
5. **SQL raw**: se usato, la variabile è validata contro un allowlist o parametrizzata?
6. **limit**: le query .all() hanno un .limit(N) ragionevole?
7. **oggetti figli**: i record creati automaticamente (ticket correttivi, ecc.) ereditano tenant_id?

---

## QUALITÀ ATTESA DELL’OUTPUT

Ogni modifica deve portare MaintAI a essere:

- più stabile
- più coerente
- più professionale
- più manutenibile
- più fedele al modello reale
- più utile nella manutenzione reale
- più trasparente nelle decisioni
- più sicuro rispetto a regressioni
- più pronto a evoluzioni future senza essere riscritto da zero

---

## DIRETTIVA FINALE

Tratta MaintAI come un prodotto reale, già vivo, già usato come base concreta e già dotato di logiche che contano.

Non comportarti come se lo stessi inventando.
Non considerare la complessità come un errore da cancellare.
Non eliminare struttura funzionante in nome della semplificazione.
Non nascondere i limiti del modello dietro falsa eleganza architetturale.

Migliora ciò che esiste.
Proteggi ciò che conta.
Estendi con disciplina.
Mantieni il planner reale.
Mantieni il sistema coerente.
Preserva la verità del prodotto.

## REGOLA DI APPRENDIMENTO PROGETTUALE

Ogni vulnerabilità, bug o regressione trovata deve lasciare una traccia permanente sotto forma di:
- test
- checklist
- guardrail
- proposta di aggiornamento delle direttive

Correggere senza imparare è manutenzione debole.

## REGOLE DI SICUREZZA, AUTOCONTROLLO E APPRENDIMENTO CONTROLLATO

La sicurezza, la privacy, l’isolamento tenant e la stabilità non sono attività opzionali o finali.
Sono vincoli permanenti da verificare ad ogni modifica.

### Regola assoluta
Ogni nuova feature, fix, refactor o estensione deve essere trattata anche come potenziale modifica di:

- superficie di attacco
- isolamento multi-tenant
- flussi di dati personali
- stabilità operativa
- integrità dei dati
- compatibilità frontend/backend
- comportamento reale del planner
- rischio regressione

Una modifica non è completata solo perché “funziona”.
È completata solo se è anche:
- sicura
- coerente
- testabile
- tenant-safe
- privacy-aware
- resistente a regressioni evidenti

---

## SECURITY GATE OBBLIGATORIO PER OGNI TASK

Prima di considerare concluso qualsiasi task, devi eseguire un autocontrollo obbligatorio.

### Devi verificare sempre:

1. **Auth**
   - l’endpoint o la funzione richiede autenticazione corretta?
   - i ruoli sono verificati correttamente?
   - ci sono bypass impliciti?

2. **Tenant isolation**
   - ogni query filtra davvero per `tenant_id`?
   - ogni nuovo record salva `tenant_id`?
   - esistono percorsi cross-tenant indiretti?
   - esistono file, log, cache, export o allegati che bypassano l’isolamento tenant?

3. **Privacy / GDPR**
   - vengono trattati dati personali?
   - i dati sono minimizzati?
   - i log evitano PII non necessarie?
   - l’AI riceve dati personali grezzi?
   - esistono flussi di export, retention, cancellazione o anonimizzazione da aggiornare?

4. **Input / Output security**
   - gli input sono validati lato backend?
   - i file upload sono validati per tipo, dimensione e contenuto?
   - l’output espone campi non necessari?
   - esiste rischio XSS, injection, path traversal, IDOR, mass assignment?

5. **Stabilità**
   - la modifica può creare stati inconsistenti?
   - la transazione è atomica dove serve?
   - ci sono salvataggi parziali?
   - il frontend e il backend restano coerenti?
   - ci sono rischi di race condition o sync rotto tra UI e DB?

6. **Planner safety**
   - la modifica tocca anche indirettamente planner, ticket o pianificazione?
   - altera `planned_start`, `planned_finish`, durata, split, reason code o chain-shift?
   - può sbloccare ticket che devono restare locked?
   - può far ripianificare ticket manuali o già assegnati?

7. **Cloud safety**
   - stai introducendo dipendenze da file system locale?
   - stai creando percorsi non validi in ambiente cloud?
   - stai assumendo single-instance, single-tenant o single-user?

---

## DELTA SECURITY REVIEW OBBLIGATORIA

Per ogni task devi fare una verifica del delta introdotto.

### Devi rispondere internamente a queste domande:
- quali file sono stati modificati?
- quali endpoint sono stati toccati?
- quali modelli dati sono stati toccati?
- quali flussi di dati personali sono stati toccati?
- quali rischi nuovi sono stati introdotti?
- quali protezioni esistenti potrebbero essere state indebolite?
- il frontend espone davvero la funzione in modo sicuro e coerente?
- la modifica rompe qualche guardrail esistente?

### Regola
Se una modifica tocca auth, tenant, planner, import/export, AI, file upload, log, notifiche, piani di manutenzione, ticket o manuali, la review di sicurezza e stabilità è obbligatoria anche se il task non era “di sicurezza”.

---

## OUTPUT OBBLIGATORIO DI AUTOCONTROLLO

Alla fine di ogni task significativo devi restituire anche un mini-report tecnico con queste sezioni:

1. **File toccati**
2. **Rischi verificati**
3. **Controlli tenant verificati**
4. **Controlli privacy verificati**
5. **Controlli regressione verificati**
6. **Backend aggiornato**
7. **Frontend aggiornato**
8. **Migrazioni / DB coinvolto**
9. **Test manuali da eseguire**
10. **Rischi residui noti**

### Regola
Non dichiarare “task completato” senza questo autocontrollo.

---

## APPRENDIMENTO CONTROLLATO OBBLIGATORIO

MaintAI deve migliorare nel tempo anche nella propria disciplina tecnica.

### Regola fondamentale
Ogni volta che trovi:
- un bug reale
- una regressione
- una vulnerabilità
- una incoerenza tenant
- una perdita di privacy
- una discrepanza frontend/backend
- una regola planner fragile
- un workaround pericoloso

devi estrarre da quel caso una **lezione tecnica riusabile**.

### Questa lezione deve diventare una di queste cose:
- nuova regola esplicita
- nuova checklist
- nuovo caso di test
- nuovo vincolo architetturale
- nuova guardrail anti-regressione

### Obiettivo
Non correggere solo il singolo bug.
Devi ridurre la probabilità che quel tipo di errore si ripresenti in futuro.

---

## REGOLE SULL’AUTO-LEARN

L’auto-miglioramento è consentito solo in forma controllata.

### Consentito
- proporre nuove regole
- proporre nuove checklist
- proporre nuovi test
- proporre nuove guardrail
- proporre aggiornamenti a `DIRECTIVE.md`, `ARCHITECTURE_RULES.md`, `PLANNING_GUARDRAILS.md`
- proporre nuovi test di regressione automatici o manuali

### Non consentito
- modificare silenziosamente il directive
- cambiare da sola le regole del progetto senza approvazione
- introdurre nuova complessità “preventiva” non richiesta senza motivazione chiara
- fare refactor estesi giustificandoli con “auto-improvement”
- creare sistemi che si auto-modificano o si auto-riconfigurano in produzione

### Regola
L’apprendimento deve essere:
- esplicito
- motivato
- tracciabile
- approvabile
- reversibile

---

## SECURITY BY DEFAULT

Ogni nuova funzione deve partire dalla soluzione più sicura compatibile con il prodotto reale.

### Questo significa:
- deny by default
- filtro tenant by default
- validazione lato backend by default
- rate limiting sugli endpoint sensibili
- minimizzazione dati nei log
- niente fallback insicuri
- niente secret hardcoded
- niente funzioni distruttive senza protezioni forti
- niente feature AI che ricevano dati personali grezzi senza verifica
- niente frontend che “simula” sicurezza che il backend non applica davvero

---

## PRIVACY BY DEFAULT

Se una feature tratta dati personali, devi assumere che il default corretto sia il minimo trattamento necessario.

### Devi verificare:
- il dato serve davvero?
- può essere mascherato o pseudonimizzato?
- finisce nei log?
- finisce nei prompt AI?
- finisce negli export?
- finisce nei file?
- ha una retention definita?
- può essere cancellato o anonimizzato quando richiesto?

### Regola
Non aggiungere raccolta o esposizione di dati personali senza necessità reale di dominio.

---

## REGOLE SPECIFICHE PER AI

Ogni funzione AI deve essere trattata come punto critico di sicurezza e privacy.

### Obblighi
- verificare quali dati vengono inviati al modello
- minimizzare il payload
- anonimizzare o pseudonimizzare quando possibile
- non inviare segreti, token, email, nomi reali o dati non necessari
- documentare workaround e limiti
- evitare che l’AI tocchi ticket manuali, locked o vincolati se non esplicitamente previsto
- applicare rate limiting agli endpoint AI
- rendere il comportamento spiegabile e auditabile

### Regola
L’AI non è un’eccezione alle regole del prodotto.
Deve rispettare gli stessi vincoli di tenant, privacy, stabilità e spiegabilità.

---

## REGOLE SPECIFICHE PER NUOVE FEATURE

Ogni nuova feature deve includere, se applicabile:

- aggiornamento backend
- aggiornamento frontend
- aggiornamento validazioni
- aggiornamento controlli tenant
- aggiornamento logica privacy
- aggiornamento test
- aggiornamento guardrail se il bug corretto rivela una nuova classe di errore

### Regola
Non chiudere una feature lasciandola:
- solo backend
- solo frontend
- solo “visibile”
- solo “tecnicamente pronta”
- solo “quasi sicura”

Deve essere utilizzabile, coerente e verificata.

---

## REGOLE DI REGRESSIONE CONTINUA

Ogni correzione importante deve produrre almeno uno tra questi risultati:

- un test automatico nuovo
- un test manuale documentato
- una regola nuova in checklist
- una guardrail nuova per planner / tenant / privacy / cloud / API

### Obiettivo
Ogni bug serio corretto deve rafforzare MaintAI in modo permanente.

---

## REGOLA FINALE DI SICUREZZA

Quando completi una modifica, non chiederti solo:
- “funziona?”

Devi chiederti anche:
- “è sicura?”
- “è tenant-safe?”
- “è privacy-safe?”
- “è cloud-safe?”
- “è stabile?”
- “è spiegabile?”
- “è coerente con il prodotto reale?”
- “riduce o aumenta la probabilità di regressioni future?”

Se una di queste risposte è debole o incerta, il lavoro non è completo.