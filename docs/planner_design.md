# Piano Tecnico — Motore Planner MaintAI
*Documento preliminare: Pseudocodice + Test Case*
*Fase 3 di implementazione verrà aggiunta dopo approvazione*

---

## 1. Modello Logico

### 1.1 Mapping Campi Esistenti vs Specifica

> [!IMPORTANT]
> I campi del DB esistente sono stati mappati fedelmente. Nessun campo inventato. I campi mancanti o con problemi di mapping sono esplicitati nella sezione 1.2.

| Campo Specifica (Tecnico) | Campo DB (`tecnici`) | Note |
|---|---|---|
| `id` | `id` | ✅ |
| `nome` | `nome` + `cognome` | ✅ combinati |
| `stato` | `stato` | ✅ (`"in servizio"` = attivo) |
| `competenze[]` | `competenze` (String CSV) | ⚠️ è una stringa CSV, va splittata |
| `ore_disponibili_giornaliere` | `ore_giornaliere` | ✅ |
| `fascia_oraria` | `orario_inizio` + `orario_fine` | ✅ (`"08:00"`, `"17:00"`) |
| `limitazioni[]` | `limitazioni_orarie` (Text JSON) | ⚠️ campo presente ma non strutturato |
| `area` | **MANCANTE** | ❌ Non esiste sul modello Tecnico |
| `impianti_abilitati[]` | **MANCANTE** | ❌ Non esiste sul modello Tecnico |

| Campo Specifica (Ticket) | Campo DB (`ticket`) | Note |
|---|---|---|
| `id` | `id` | ✅ |
| `impianto` | `asset.impianto_id` | ✅ via join Asset → Impianto |
| `priorita` | `priorita` | ✅ (`"Alta"`, `"Media"`, `"Bassa"`) |
| `durata_stimata` | `durata_stimata_ore` | ✅ |
| `competenza_richiesta` | **MANCANTE** | ❌ Non esiste sul ticket. Solo sull'`AttivitaManutenzione.priorita` non è competenza |
| `finestra_inizio` / `finestra_fine` | `planned_start` / `planned_finish` | ⚠️ Usati come output, non come constraint di input |
| `limitazioni[]` | `asset.limitazioni` (Text) | ⚠️ È a livello asset, non ticket |
| `area` | `asset.area` | ✅ via join Asset |
| `tecnici_richiesti` | **MANCANTE** | ❌ Non esiste sul ticket |
| `splittabile` | `is_continuation` | ⚠️ Parziale: indica se è già splittatoe, non se può essere splittato |
| `scadenza_sla` | **MANCANTE** | ❌ Non esiste sul ticket (solo `prossima_scadenza` su AttivitaManutenzione) |

| Campo Specifica (Assignments) | Campo DB | Note |
|---|---|---|
| `ticket_id` | `ticket.id` | ✅ |
| `tecnico_id` | `ticket.tecnico_id` | ✅ |
| `start` | `ticket.planned_start` | ✅ |
| `end` | `ticket.planned_finish` | ✅ |
| `locked` | **MANCANTE** | ❌ Non esiste sul ticket nel DB attuale |

### 1.2 Campi Mancanti — Da Segnalare Esplicitamente

> [!WARNING]
> I seguenti campi sono richiesti dalla specifica ma **non presenti nel DB attuale**. L'implementazione li gestirà tramite valori di default o logica approssimativa, segnalata nel codice.

1. **`Tecnico.area`** — Non esiste. Il planner non potrà applicare il soft-rule "preferire area compatibile". *Workaround: skip della regola.*
2. **`Tecnico.impianti_abilitati[]`** — Non esiste. Il planner non potrà filtrare per impianto abilitato. *Workaround: skip del filtro, tutti i tecnici sono considerati disponibili per tutti gli impianti.*
3. **`Ticket.competenza_richiesta`** — Non esiste. Utilizzato `tipo` (PM/CM/BD) come proxy di competenza. La logica sarà: skill richiesta = `tipo.lower()` del ticket.
4. **`Ticket.tecnici_richiesti`** — Non esiste. Assunto `= 1` per tutti i ticket. Il reason code `MULTI_TECH_NOT_FOUND` non sarà mai triggerato.
5. **`Ticket.splittabile`** — Approssimato. Il planner splitta automaticamente se `durata_stimata_ore > ore_giornaliere_tecnico`. La flag `is_continuation` viene impostata sui frammenti.
6. **`Ticket.scadenza_sla`** — Non esiste. Il sorting per SLA userà `prossima_scadenza` da `AttivitaManutenzione` se disponibile, altrimenti `created_at` come proxy.
7. **`Assignment.locked`** — Non esiste sul ticket. Il planner rispetterà `tecnico_id IS NOT NULL AND planned_start IS NOT NULL` come proxy di "locked" implicito (già assegnato → non toccare).

---

## 2. Pseudocodice

```
FUNCTION run_planner(tecnici, tickets, existing_assignments, horizon_days, today):

  # ── FASE 0: Costruzione strutture dati ─────────────────────────────────────
  
  tecnici_attivi = [t for t in tecnici if t.stato == "in_servizio"]
  
  # Mappa di ore consumate per tecnico per giorno:  {tecnico_id: {date: ore_usate}}
  ore_consumate = {}
  
  FOR EACH assignment IN existing_assignments WHERE assignment.locked == TRUE:
    giorno = date(assignment.start)
    ore_consumate[assignment.tecnico_id][giorno] += durata(assignment.start, assignment.end)
  
  # Ticket già locked → escludi da scheduling
  ticket_locked_ids = {a.ticket_id for a in existing_assignments if a.locked}
  
  tickets_da_pianificare = [t for t in tickets if t.id NOT IN ticket_locked_ids]
  
  # ── FASE 1: Ordinamento ticket (priorità scheduling) ───────────────────────
  
  SORT tickets_da_pianificare BY:
    1. priorita_score(t.priorita)   DESC     # Alta=3, Media=2, Bassa=1
    2. sla_urgency(t.scadenza_sla)  ASC      # SLA più vicino prima
    3. tipo_score(t.tipo)           DESC     # BD=3, CM=2, PM=1
  
  # ── FASE 2: Loop di allocazione ────────────────────────────────────────────
  
  assignments    = []   # risultato finale
  unassigned     = []   # ticket non pianificabili
  explanation_log = []  # log per debugging
  
  FOR EACH ticket IN tickets_da_pianificare:
  
    candidati = find_candidati(ticket, tecnici_attivi, ore_consumate, horizon_days, today)
    
    IF candidati IS EMPTY:
      unassigned.append({ticket_id: ticket.id, reason_code: candidati.failure_reason})
      CONTINUE
    
    # Scegli miglior candidato tramite scoring
    best = score_ranking(candidati, ticket, ore_consumate)
    
    # Tenta allocazione (gestendo split se necessario)
    result = allocate(ticket, best.tecnico, best.day, ore_consumate)
    
    IF result.success:
      FOR EACH fragment IN result.fragments:
        assignments.append(fragment)
        ore_consumate[fragment.tecnico_id][fragment.day] += fragment.durata
    ELSE:
      unassigned.append({ticket_id: ticket.id, reason_code: result.reason_code})
  
  RETURN {assignments, unassigned, explanation_log}


FUNCTION find_candidati(ticket, tecnici_attivi, ore_consumate, horizon_days, today):
  """Ritorna lista di (tecnico, giorno) validi per il ticket, con reason-code se vuota."""
  
  candidati = []
  failure_reasons = set()
  
  FOR EACH giorno IN range(today, today + horizon_days):
  FOR EACH tecnico IN tecnici_attivi:
  
    # HARD RULE 1: Skill match
    IF ticket.competenza_richiesta NOT IN tecnico.competenze:
      failure_reasons.add("NO_SKILL")
      CONTINUE
    
    # HARD RULE 2: Limitazioni ticket vs tecnico
    IF has_limitation_mismatch(ticket.limitazioni, tecnico.limitazioni):
      failure_reasons.add("LIMITATION_MISMATCH")
      CONTINUE
    
    # HARD RULE 3: Finestra temporale ticket
    IF giorno < ticket.finestra_inizio OR giorno > ticket.finestra_fine:
      failure_reasons.add("TIME_WINDOW_CONFLICT")
      CONTINUE
    
    # HARD RULE 4: Capacità residua del giorno
    ore_usate = ore_consumate[tecnico.id][giorno]
    ore_residue = tecnico.ore_giornaliere - ore_usate
    
    IF ore_residue <= 0:
      failure_reasons.add("CAPACITY_EXCEEDED")
      CONTINUE
    
    # HARD RULE 5: Niente sovrapposizioni (già garantito da ore_consumate aggregato)
    # Nota: tracking granulare a slot sarebbe necessario per gap management preciso
    
    # Se tutti i check passano → candidato valido
    candidati.append({tecnico: tecnico, giorno: giorno, ore_residue: ore_residue})
  
  IF candidati IS EMPTY:
    # Priorità reason: NO_SKILL > LIMITATION_MISMATCH > TIME_WINDOW > CAPACITY
    prioritized_reason = pick_reason(failure_reasons)
    candidati.failure_reason = prioritized_reason
  
  RETURN candidati


FUNCTION score_ranking(candidati, ticket, ore_consumate):
  """Applica soft rules per ordinare i candidati e selezionare il migliore."""
  
  FOR EACH c IN candidati:
    score = 0
    
    # SOFT RULE 1: Tecnico già attivo sullo stesso impianto (+3)
    IF tecnico_has_ticket_on_impianto(c.tecnico, ticket.impianto, c.giorno):
      score += 3
    
    # SOFT RULE 2: Saturazione ottimale: preferire tecnico con meno ore libere
    #   (per riempire meglio le giornate, ridurre frammentazione)
    saturazione = ore_consumate[c.tecnico.id][c.giorno] / c.tecnico.ore_giornaliere
    score += saturazione * 2   # max 2 punti
    
    # SOFT RULE 3: Area compatibile (+1) — SOLO SE campo area esiste (attualmente mancante)
    # IF c.tecnico.area == ticket.area: score += 1
    
    # SOFT RULE 4: SLA urgency già gestita nel sort iniziale dei ticket
    
    c.score = score
  
  RETURN max(candidati, key=lambda c: c.score)


FUNCTION allocate(ticket, tecnico, giorno_start, ore_consumate):
  """Tenta di allocare il ticket, splittando se necessario."""
  
  ore_residue_giorno = tecnico.ore_giornaliere - ore_consumate[tecnico.id][giorno_start]
  durata_totale = ticket.durata_stimata_ore
  
  # Caso semplice: entra tutto in un giorno
  IF durata_totale <= ore_residue_giorno:
    start_time = calcola_start(tecnico, giorno_start, ore_consumate)
    end_time = start_time + durata_totale
    RETURN success([{
      ticket_id: ticket.id, tecnico_id: tecnico.id,
      start: datetime(giorno_start, start_time),
      end: datetime(giorno_start, end_time),
      is_continuation: FALSE, parent_ticket_id: NULL
    }])
  
  # Caso split
  IF ticket.splittabile == FALSE:
    # Cerca giorno con abbastanza ore libere consecutive
    FOR giorno IN range(giorno_start+1, giorno_start+14):
      ore_libere = tecnico.ore_giornaliere - ore_consumate[tecnico.id][giorno]
      IF ore_libere >= durata_totale:
        RETURN allocate(ticket, tecnico, giorno, ore_consumate)  # ricorsivo
    RETURN failure("CAPACITY_EXCEEDED")
  
  # Split: frammento 1 nel giorno corrente, resto nei giorni successivi
  fragments = []
  ore_rimanenti = durata_totale
  giorno_corrente = giorno_start
  primo_fragment = TRUE
  
  WHILE ore_rimanenti > 0:
    ore_libere = tecnico.ore_giornaliere - ore_consumate[tecnico.id][giorno_corrente]
    ore_da_allocare = min(ore_rimanenti, ore_libere)
    
    IF ore_da_allocare <= 0:
      giorno_corrente += 1
      CONTINUE
    
    start_time = calcola_start(tecnico, giorno_corrente, ore_consumate)
    fragments.append({
      ticket_id: ticket.id, tecnico_id: tecnico.id,
      start: datetime(giorno_corrente, start_time),
      end: datetime(giorno_corrente, start_time + ore_da_allocare),
      is_continuation: NOT primo_fragment,
      parent_ticket_id: ticket.id IF NOT primo_fragment ELSE NULL
    })
    
    ore_rimanenti -= ore_da_allocare
    giorno_corrente += 1
    primo_fragment = FALSE
  
  RETURN success(fragments)
```

---

## 3. Test Case

### TC-01: Assegnazione semplice — Happy Path
**Scenario**: 1 ticket PM da 2h, 1 tecnico disponibile con skill "PM", 8h/giorno libere.

```
INPUT:
  tecnici = [{id:1, stato:"in_servizio", competenze:["PM"], ore_giornaliere:8, orario:"08:00-17:00"}]
  tickets  = [{id:101, tipo:"PM", durata:2, priorita:"Media", competenza:"PM", finestra:7giorni}]
  existing_assignments = []

EXPECTED OUTPUT:
  assignments = [{ticket_id:101, tecnico_id:1, start:"2026-04-06T08:00", end:"2026-04-06T10:00", is_continuation:false}]
  unassigned  = []
```
**Verifica**: Il ticket è pianificato nel primo giorno disponibile, nella fascia mattutina.

---

### TC-02: NO_SKILL — Tecnico non qualificato
**Scenario**: 1 ticket BD, tecnico ha solo skill PM.

```
INPUT:
  tecnici  = [{id:1, stato:"in_servizio", competenze:["PM"], ore_giornaliere:8}]
  tickets  = [{id:102, tipo:"BD", durata:3, competenza:"BD"}]

EXPECTED OUTPUT:
  assignments = []
  unassigned  = [{ticket_id:102, reason_code:"NO_SKILL"}]
```
**Verifica**: Nessuna assegnazione, reason_code corretto.

---

### TC-03: Split automatico su più giorni
**Scenario**: Ticket da 10h, tecnico con 8h/giorno. Ticket splittabile.

```
INPUT:
  tecnici  = [{id:1, stato:"in_servizio", competenze:["CM"], ore_giornaliere:8}]
  tickets  = [{id:103, tipo:"CM", durata:10, competenza:"CM", splittabile:true}]

EXPECTED OUTPUT:
  assignments = [
    {ticket_id:103, tecnico_id:1, start:"Giorno1 08:00", end:"Giorno1 16:00", is_continuation:false},
    {ticket_id:103, tecnico_id:1, start:"Giorno2 08:00", end:"Giorno2 10:00", is_continuation:true}
  ]
  unassigned = []
```
**Verifica**: 8h giorno 1 + 2h giorno 2, is_continuation=true sul frammento 2.

---

### TC-04: CAPACITY_EXCEEDED — Tecnico pieno
**Scenario**: Tecnico ha già 8 ore di lavoro locked nel giorno, nessun altro giorno disponibile nell'orizzonte.

```
INPUT:
  tecnici  = [{id:1, stato:"in_servizio", competenze:["PM"], ore_giornaliere:8}]
  tickets  = [{id:104, tipo:"PM", durata:2, finestra:oggi-oggi}]
  existing_assignments = [{ticket_id:99, tecnico_id:1, start:"Oggi 08:00", end:"Oggi 16:00", locked:true}]

EXPECTED OUTPUT:
  assignments = []
  unassigned  = [{ticket_id:104, reason_code:"CAPACITY_EXCEEDED"}]
```
**Verifica**: Finestra ticket è solo oggi, tecnico è pieno → CAPACITY_EXCEEDED.

---

### TC-05: Soft Rule — Preferire tecnico dello stesso impianto
**Scenario**: 2 tecnici disponibili, entrambi qualificati. Uno ha già un ticket sull'impianto del nuovo ticket.

```
INPUT:
  tecnici  = [
    {id:1, competenze:["PM"]},
    {id:2, competenze:["PM"]}   ← ha già ticket sull'impianto 42 oggi
  ]
  tickets  = [{id:105, tipo:"PM", durata:2, impianto_id:42}]
  existing_assignments = [{ticket_id:50, tecnico_id:2, impianto_id:42, giorno: oggi}]

EXPECTED OUTPUT:
  assignments = [{ticket_id:105, tecnico_id:2, ...}]   ← tecnico 2 preferito
```
**Verifica**: Entrambi validi (hard rules), ma il tecnico già in loco vince sul ranking.

---

## 4. Note Implementative pre-Codice

> [!NOTE]
> Prima di procedere con l'implementazione Python, verificare con il team:

1. **Granularità slot**: Il tracking attuale usa `ore_consumate` aggregato per giorno. Per evitare overlap precisi (es. 2 ticket con start identico), serve un tracking a slot di 30 minuti `{tecnico_id: {date: List[bool x 18]}}`.
2. **Campo `locked`**: Va aggiunto il campo `locked = Column(Boolean, default=False)` al modello `Ticket`, oppure la logica di "non modificare" si basa su `planned_start IS NOT NULL AND tecnico_id IS NOT NULL` (convenzione attuale).
3. **Campo `competenza_richiesta`**: Va aggiunto al modello `Ticket` oppure si usa `tipo` come proxy permanente. Raccomandazione: aggiungere il campo.
4. **Campi `area` e `impianti_abilitati` su Tecnico**: La soft rule di area non sarà attiva finché i campi non vengono aggiunti. Il codice sarà predisposto per riceverli opzionalmente.
5. **Test di integrazione**: I 5 test case sopra vanno tradotti in test unitari Python in `backend/tests/test_planner.py` usando un DB SQLite in-memory.
