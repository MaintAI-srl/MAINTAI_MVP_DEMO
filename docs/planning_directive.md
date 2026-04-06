# PLANNING_GUARDRAILS.md

## SCOPO

Questo file definisce i vincoli obbligatori per qualsiasi intervento sul motore di planning di **MaintAI**.

Il planner non deve essere trattato come una semplice vista calendario o una board grafica.
Il planner è una logica operativa che usa i dati reali esistenti nel database per assegnare ticket ai tecnici rispettando vincoli, priorità e capacità.

Questo file è vincolante per ogni modifica a:

- logica di scheduling
- funzioni di ranking
- regole di allocazione
- split automatico
- gestione ticket già assegnati
- reason code dei ticket non pianificabili
- integrazione frontend/backend del planning

---

## PRINCIPIO FONDAMENTALE

Il planner deve lavorare **solo sulla base dei campi realmente esistenti** nel database attuale oppure su workaround esplicitamente dichiarati.

### Regola assoluta
Non inventare campi, entità o logiche non presenti nel modello reale senza dichiararlo in modo esplicito.

Se un campo richiesto dalla specifica non esiste nel DB attuale:

- non va simulato in modo nascosto
- non va inventato come se fosse già disponibile
- va gestito tramite fallback o approssimazione esplicita
- il codice deve rendere chiaro il workaround adottato

---

## MODELLO DATI: REGOLE DI MAPPING OBBLIGATORIE

## Tecnici

Usare solo questi mapping reali dal DB `tecnici`:

- `id` → `id`
- `nome completo` → `nome` + `cognome`
- `stato` → `stato`
- `competenze[]` → `competenze` come stringa CSV da splittare
- `ore_disponibili_giornaliere` → `ore_giornaliere`
- `fascia_oraria` → `orario_inizio` + `orario_fine`
- `limitazioni[]` → `limitazioni_orarie` come testo JSON o testo non strutturato

### Campi non presenti sul tecnico
I seguenti campi **non esistono** nel modello attuale e non devono essere dati per scontati:

- `area`
- `impianti_abilitati[]`

### Conseguenza obbligatoria
Le regole che dipendono da questi campi devono essere saltate o gestite come opzionali, mai trattate come già implementate.

---

## Ticket

Usare solo questi mapping reali dal DB `ticket` e dalle relazioni esistenti:

- `id` → `id`
- `impianto` → `asset.impianto_id`
- `priorita` → `priorita`
- `durata_stimata` → `durata_stimata_ore`
- `area` → `asset.area`
- `limitazioni[]` → `asset.limitazioni`
- `planned_start` / `planned_finish` → campi di output di planning
- `tecnico_id` → tecnico assegnato
- `is_continuation` → indica frammento già splittato, non la splittabilità nativa

### Campi non presenti sul ticket
I seguenti campi **non esistono** nel modello attuale:

- `competenza_richiesta`
- `tecnici_richiesti`
- `splittabile` come flag reale
- `scadenza_sla`
- `locked`

### Workaround obbligatori
Fino a modifica del modello, il planner deve usare questi fallback:

1. **Competenza richiesta**
   - usare `ticket.tipo.lower()` come proxy della skill richiesta
   - esempio: `PM`, `CM`, `BD`

2. **Tecnici richiesti**
   - assumere sempre `= 1`

3. **Splittabilità**
   - considerare un ticket splittabile quando `durata_stimata_ore > ore_giornaliere del tecnico`
   - usare `is_continuation = true` sui frammenti successivi

4. **SLA**
   - usare `AttivitaManutenzione.prossima_scadenza` se disponibile
   - altrimenti usare `created_at` come proxy di urgenza

5. **Locked**
   - considerare “locked implicito” ogni ticket con:
     - `tecnico_id IS NOT NULL`
     - `planned_start IS NOT NULL`
   - un ticket locked implicito non deve essere ripianificato

---

## REGOLA DI BASE SUI TICKET GIÀ ASSEGNATI

Il planner **non deve modificare** ticket già assegnati secondo la convenzione corrente.

### Proxy di locked attuale
Un ticket è da considerarsi non modificabile se ha già:

- `tecnico_id valorizzato`
- `planned_start valorizzato`

### Conseguenza
Questi ticket devono essere esclusi dalla lista dei ticket da pianificare.

Non devono essere:

- rispostati
- riassegnati
- risplittati
- ricalcolati

salvo futura introduzione esplicita di una logica diversa.

---

## ORDINE DI PRIORITÀ DEL PLANNER

I ticket da pianificare devono essere ordinati secondo queste regole:

1. **Priorità**
   - Alta prima
   - Media dopo
   - Bassa per ultima

2. **Urgenza SLA**
   - scadenza più vicina prima
   - in assenza di SLA reale usare il proxy definito sopra

3. **Tipo ticket**
   - `BD` prima di `CM`
   - `CM` prima di `PM`

### Regola
Questo ordinamento è parte della logica del planner.
Non va rimosso o banalizzato per ragioni estetiche o di semplificazione.

---

## HARD RULES OBBLIGATORIE

Un candidato `(tecnico, giorno)` è valido solo se supera tutte le regole hard.

### HARD RULE 1 — Skill match
La competenza richiesta del ticket deve essere presente nelle competenze del tecnico.

Fino a nuova evoluzione modello:
- skill ticket = `ticket.tipo.lower()`
- skill tecnico = `split CSV campo competenze`

Se manca il match:
- reason code possibile: `NO_SKILL`

---

### HARD RULE 2 — Compatibilità limitazioni
Le limitazioni del ticket o dell’asset devono essere compatibili con le limitazioni del tecnico.

Dato che:
- il ticket non ha limitazioni proprie strutturate
- le limitazioni arrivano da `asset.limitazioni`
- le limitazioni del tecnico sono in `limitazioni_orarie` non sempre strutturate

questa regola va implementata in modo prudente e trasparente.

Se c’è mismatch:
- reason code possibile: `LIMITATION_MISMATCH`

---

### HARD RULE 3 — Finestra temporale
Il planner deve rispettare la finestra temporale valida del ticket.

Nota importante:
i campi `planned_start` e `planned_finish` sono oggi usati come output.
Se esiste una finestra di input separata, va usata.
Se non esiste, non si deve fingere che il ticket abbia constraint temporali precisi non presenti nel modello.

Quando la finestra temporale è definita e il giorno non è valido:
- reason code possibile: `TIME_WINDOW_CONFLICT`

---

### HARD RULE 4 — Capacità residua del tecnico
Per ogni tecnico e giorno, la capacità residua va calcolata come:

`ore_residue = ore_giornaliere - ore_consumate`

Se `ore_residue <= 0`, il candidato non è valido.

Reason code possibile:
- `CAPACITY_EXCEEDED`

---

### HARD RULE 5 — Nessuna modifica dei locked
Le assegnazioni già considerate locked devono concorrere al consumo capacità e non devono essere toccate.

---

## TRACKING DELLA CAPACITÀ

Il planner usa come base una struttura simile a:

- `{tecnico_id: {giorno: ore_usate}}`

Questa logica è accettabile come versione iniziale, ma ha un limite noto:

- evita il superamento ore giornaliere
- non garantisce da sola la gestione precisa di slot orari e overlap minuti per minuto

### Limite noto
Per evitare collisioni precise, il sistema dovrà evolvere verso tracking a slot, ad esempio ogni 30 minuti.

### Regola
Non fingere che il tracking aggregato per giorno risolva già i conflitti di dettaglio orario.
Se si usa tracking giornaliero, questa limitazione va mantenuta esplicita nel codice e nella documentazione.

---

## SOFT RULES OBBLIGATORIE

Se più candidati superano le hard rules, il planner deve applicare ranking con soft rules.

### SOFT RULE 1 — Preferire tecnico già attivo sullo stesso impianto
Se un tecnico ha già un ticket assegnato sullo stesso impianto nello stesso giorno, deve essere favorito.

Questa regola ha priorità alta nel ranking.

---

### SOFT RULE 2 — Preferire saturazione utile
Tra più candidati validi, favorire il tecnico che consente migliore saturazione della giornata, per ridurre frammentazione.

In pratica:
- privilegiare chi ha meno ore residue inutilizzate
- senza violare le hard rules

---

### SOFT RULE 3 — Compatibilità area
Questa regola è prevista solo se il campo `Tecnico.area` esisterà.

### Stato attuale
Poiché il campo non esiste nel modello tecnico:
- la regola non deve essere considerata attiva
- il codice può essere predisposto per supportarla in futuro
- non va simulata artificialmente

---

## ALLOCAZIONE: REGOLE OBBLIGATORIE

## Caso semplice
Se la durata del ticket entra nelle ore residue del giorno scelto:

- assegnare tutto nello stesso giorno
- usare orario di inizio coerente con disponibilità del tecnico e ore già consumate
- valorizzare:
  - `ticket_id`
  - `tecnico_id`
  - `start`
  - `end`
  - `is_continuation = false`

---

## Caso con split automatico
Se la durata del ticket supera la capacità del giorno ma il ticket può essere spezzato secondo la logica attuale:

- creare frammenti su giorni successivi
- mantenere lo stesso tecnico
- primo frammento:
  - `is_continuation = false`
- frammenti successivi:
  - `is_continuation = true`
  - `parent_ticket_id = ticket.id`

### Regola importante
Lo split non è una funzione estetica del frontend.
È una logica reale di allocazione che deve restare lato planner.

---

## Caso non allocabile
Se non esiste alcun candidato valido o nessuna allocazione possibile:

- il ticket deve finire in `unassigned`
- con `reason_code` coerente e tracciabile

---

## REASON CODE OBBLIGATORI

Il planner deve produrre reason code chiari quando un ticket non è pianificabile.

I reason code minimi da preservare sono:

- `NO_SKILL`
- `LIMITATION_MISMATCH`
- `TIME_WINDOW_CONFLICT`
- `CAPACITY_EXCEEDED`

### Regola
Se più cause sono possibili, la selezione del reason code finale deve seguire una priorità coerente.
Esempio di priorità accettabile:

1. `NO_SKILL`
2. `LIMITATION_MISMATCH`
3. `TIME_WINDOW_CONFLICT`
4. `CAPACITY_EXCEEDED`

---

## LOG E SPIEGABILITÀ

Il planner deve produrre un log spiegabile, utile per debugging e analisi.

### Deve essere possibile capire almeno:
- perché un ticket è stato assegnato a un certo tecnico
- perché un ticket è rimasto non assegnato
- quale regola ha escluso un candidato
- quando è stato applicato lo split

### Regola
Non trasformare il planner in una black box muta.
La spiegabilità è parte del valore del motore.

---

## COSA NON DEVE FARE IL PLANNER

Non deve:

- inventare campi mancanti
- assumere dati non presenti nel DB
- modificare ticket locked
- trattare `planned_start` e `planned_finish` come vincoli input se sono output
- ignorare la capacità giornaliera
- assegnare tecnici senza match skill
- ignorare limitazioni note
- perdere i reason code
- spostare la logica reale nel solo frontend
- ridursi a una semplice board drag-and-drop

---

## TEST CASE OBBLIGATORI DA PRESERVARE

Ogni implementazione o refactor del planner deve continuare a soddisfare almeno questi casi.

### TC-01 — Assegnazione semplice
- ticket PM da 2h
- 1 tecnico disponibile con skill PM
- 8h libere
- risultato atteso: assegnazione nel primo slot utile

### TC-02 — NO_SKILL
- ticket BD
- tecnico con sola skill PM
- risultato atteso: `unassigned` con `NO_SKILL`

### TC-03 — Split automatico
- ticket da 10h
- tecnico con 8h/giorno
- risultato atteso: split su 2 giorni con `is_continuation = true` dal secondo frammento

### TC-04 — CAPACITY_EXCEEDED
- tecnico pieno per tutta la finestra utile
- risultato atteso: `unassigned` con `CAPACITY_EXCEEDED`

### TC-05 — Preferenza stesso impianto
- due tecnici validi
- uno ha già lavoro sullo stesso impianto
- risultato atteso: viene favorito quello già sul posto

---

## EVOLUZIONI FUTURE PREVISTE

Il planner deve essere scritto in modo da poter accogliere, senza essere demolito, queste evoluzioni:

1. tracking a slot da 30 minuti
2. campo reale `locked`
3. campo reale `competenza_richiesta`
4. campi `Tecnico.area` e `Tecnico.impianti_abilitati`
5. test di integrazione strutturati con DB SQLite in-memory
6. eventuale gestione futura di `tecnici_richiesti > 1`

### Regola
Preparare il codice a queste evoluzioni non significa fingere che esistano già.

---

## STRATEGIA DI MODIFICA CONSENTITA

Quando si modifica il planner, usare questo ordine:

1. correzione mirata
2. miglioramento locale
3. estensione contenuta
4. refactor prudente
5. riscrittura ampia solo se inevitabile

### Regola
Se una modifica tocca il planner, deve migliorare almeno uno di questi aspetti senza peggiorare gli altri:

- correttezza logica
- robustezza
- leggibilità del codice
- spiegabilità
- compatibilità col DB reale
- estendibilità futura

---

## TEST CASE IMPLEMENTATI E VERIFICATI (aggiornamento ciclo v2.0.3-v2.0.4)

I seguenti test sono implementati in `backend/tests/test_planner_engine.py` e devono continuare a passare:

| ID | Descrizione | File |
|---|---|---|
| TC-01 | Happy path: assegnazione semplice PM 2h | test_planner_engine.py |
| TC-02 | NO_SKILL: ticket BD con tecnico solo PM | test_planner_engine.py |
| TC-03 | Split automatico: 10h su tecnico da 8h/giorno | test_planner_engine.py |
| TC-04 | CAPACITY_EXCEEDED: tecnico pieno, finestra ristrettissima | test_planner_engine.py |
| TC-05 | Soft rule: preferire tecnico già su stesso impianto | test_planner_engine.py |
| TC-06 | Tecnico fuori servizio ignorato | test_planner_engine.py |
| TC-07 | LIMITATION_MISMATCH: notturno/no_notturno | test_planner_engine.py |
| TC-08 | TIME_WINDOW_CONFLICT: finestra fuori orizzonte | test_planner_engine.py |
| TC-09 | Assenza parziale: pianificato sul giorno disponibile | test_planner_engine.py |
| TC-09b | Assenza totale: CAPACITY_EXCEEDED | test_planner_engine.py |
| TC-10 | Locked ticket escluso, capacità consumata | test_planner_engine.py |
| TC-11 | Priorità: BD pianificato prima di PM con capacità limitata | test_planner_engine.py |

### Regola
Ogni modifica al PlannerEngine deve mantenere 12/12 test passing.
Prima di ogni commit che tocca planner_engine.py o planner_engine_bridge.py, eseguire:
```bash
python -m pytest backend/tests/test_planner_engine.py -v
```

---

## ROBUSTEZZA DEL MOTORE (aggiornamento ciclo v2.0.3)

### _parse_time safe
`_parse_time()` ha fallback a 08:00/17:00 in caso di stringa malformata.
Non modificare questo comportamento — le configurazioni tecnico reali possono avere orari non standard.

### _make_assignment clamp
`end_dt` è clampato a `orario_fine` del tecnico per evitare overflow visivo sul Gantt.
Il clamp non altera la capacità (gestita separatamente da ore_consumate) — è solo cosmetic.

### Bridge: filtro locked_ids
Il filtro `~Ticket.id.in_(locked_ids)` deve essere applicato come `.filter()` condizionale,
NON come `~... if locked_ids else True` (Python True non è una BinaryExpression SQLAlchemy valida).

---

## DIRETTIVA FINALE

Il planner di MaintAI è una logica operativa reale, non un esercizio teorico.

Deve lavorare con i dati veri che esistono oggi, dichiarare in modo esplicito i workaround, rispettare i ticket già assegnati, applicare hard rules prima delle soft rules, gestire split coerenti e produrre output spiegabili.

Se una modifica rende il planner più “semplice” ma meno fedele al modello reale, meno tracciabile o meno utile operativamente, allora è una cattiva modifica.