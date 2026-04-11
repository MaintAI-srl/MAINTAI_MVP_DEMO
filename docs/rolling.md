# rolling.md
## Direttiva di implementazione completa
## Rolling 7-Day Planning & Scheduling Engine per MaintAI

---

# 1. Scopo

Implementare un motore di pianificazione e schedulazione manutentiva a **orizzonte mobile di 7 giorni** con:

- protezione del breve termine
- gestione controllata del reattivo
- tutela delle attività preventive e compliance
- aggiornamento giornaliero con roll-forward di 24 ore
- minimizzazione delle ripianificazioni distruttive
- tracciabilità completa delle decisioni

Il sistema **DEVE** distinguere chiaramente tra:

- **Planning** = preparazione del lavoro futuro
- **Scheduling** = collocazione temporale e assegnazione delle risorse

Il sistema **NON DEVE** comportarsi come un semplice calendario.  
Il sistema **DEVE** prendere decisioni basate su readiness, priorità, rischio, disponibilità e costo di disruption del piano.

---

# 2. Obiettivi operativi

Il motore **DEVE** ottimizzare contemporaneamente:

1. saturazione utile delle ore disponibili
2. stabilità del piano nel breve termine
3. protezione delle PM in scadenza
4. gestione credibile dei breakdown
5. riduzione dei tempi morti
6. riduzione delle ripianificazioni inutili
7. miglioramento del wrench time
8. maggiore compliance del piano esecutivo

---

# 3. Principi architetturali

## 3.1 Separazione logica

Il sistema **DEVE** separare i seguenti layer:

- **Layer A - Readiness**
- **Layer B - Prioritizzazione**
- **Layer C - Planning**
- **Layer D - Scheduling**
- **Layer E - Re-optimization**
- **Layer F - Execution Feedback**

## 3.2 Regola fondamentale

Un ticket **NON PUÒ** entrare in schedulazione se non è almeno in stato `READY`.

## 3.3 Protezione del piano

Le prossime 24 ore **DEVONO** essere considerate finestra congelata salvo override forte e motivato.

## 3.4 Reattivo controllato

Il reattivo **DEVE** essere assorbito secondo regole di priorità e impatto, senza distruggere automaticamente PM e compliance.

## 3.5 Roll-forward quotidiano

Ogni giorno il sistema **DEVE** avanzare l’orizzonte di 24 ore, rivalutando:

- nuovi ticket
- stato readiness
- disponibilità risorse
- materiali
- vincoli operativi
- urgenze reali
- backlog

---

# 4. Orizzonte temporale e finestre

L’orizzonte totale è di **7 giorni = 168 ore**.

## 4.1 Suddivisione in finestre

### Fascia A: 0-24h
Stato: `FROZEN`

Regole:
- il piano è bloccato
- possono entrare solo ticket ad alta gravità
- ogni inserimento deve generare override esplicito
- ogni modifica deve riportare impatto sul piano esistente

### Fascia B: 24-48h
Stato: `PROTECTED`

Regole:
- il piano è protetto
- sono ammesse modifiche solo per ticket significativi
- i ticket PM critici e compliance non devono essere spostati salvo forte motivazione

### Fascia C: 48-72h
Stato: `FLEXIBLE`

Regole:
- è ammesso inserire nuovi ticket
- è ammesso riottimizzare carichi, skill e accorpamenti
- è vietato degradare inutilmente ticket PM già pronti e coerenti

### Fascia D: 72-168h
Stato: `DYNAMIC`

Regole:
- backlog e nuovi ticket sono liberamente ribilanciabili
- il sistema deve ottimizzare saturazione, readiness, logistica e scadenze
- il sistema deve proteggere i ticket PM in prossimità di scadenza

---

# 5. Modello dati minimo obbligatorio

Ogni ticket **DEVE** avere almeno i seguenti campi.

## 5.1 Identificativi

- `ticket_id`
- `titolo`
- `descrizione`
- `asset_id`
- `area_id`
- `site_id`

## 5.2 Classificazione

- `ticket_type`  
  Valori minimi:
  - `BREAKDOWN`
  - `CORRECTIVE`
  - `PM`
  - `INSPECTION`
  - `COMPLIANCE`
  - `IMPROVEMENT`

- `priority_class`  
  Valori minimi:
  - `P1`
  - `P2`
  - `P3`
  - `P4`
  - `P5`

## 5.3 Criticità e impatto

- `asset_criticality`
- `safety_impact`
- `production_impact`
- `compliance_impact`
- `environmental_impact`
- `economic_impact`
- `escalation_risk`

## 5.4 Vincoli temporali

- `requested_date`
- `earliest_start_date`
- `latest_allowed_date`
- `due_date`
- `estimated_duration_hours`

## 5.5 Risorse e competenze

- `required_skills[]`
- `required_people_count`
- `required_tools[]`
- `required_materials[]`

## 5.6 Stato readiness

- `materials_ready`
- `tools_ready`
- `permits_ready`
- `access_ready`
- `skills_ready`
- `job_plan_ready`

## 5.7 Stato operativo

- `planning_status`
- `schedule_status`
- `freeze_zone`
- `pm_protected`
- `can_be_bumped`
- `override_required`

## 5.8 Audit decisionale

- `planned_by`
- `last_planned_at`
- `reschedule_count`
- `last_override_reason`
- `last_disruption_cost`
- `decision_trace`

---

# 6. Stati obbligatori del ticket

## 6.1 Planning status

Il campo `planning_status` **DEVE** avere almeno questi valori:

- `NEW`
- `SCREENED`
- `NOT_READY`
- `READY`
- `PLANNED`
- `BLOCKED`
- `COMPLETED`
- `CANCELLED`

## 6.2 Schedule status

Il campo `schedule_status` **DEVE** avere almeno questi valori:

- `UNSCHEDULED`
- `SCHEDULED`
- `IN_PROGRESS`
- `DONE`
- `DEFERRED`
- `BUMPED`

## 6.3 Freeze zone

Il campo `freeze_zone` **DEVE** avere almeno questi valori:

- `FROZEN_24`
- `PROTECTED_48`
- `FLEXIBLE_72`
- `DYNAMIC_168`

---

# 7. Readiness Gate

## 7.1 Regola

Un ticket può diventare `READY` solo se:

- skill disponibili
- accesso disponibile
- eventuali permessi disponibili
- materiali critici disponibili oppure esplicitamente non necessari
- job plan minimo disponibile
- durata stimata credibile

## 7.2 Blocco

Se anche uno solo dei prerequisiti critici manca, il ticket **DEVE** essere classificato come `NOT_READY`.

## 7.3 Conseguenza

Un ticket `NOT_READY`:

- non può entrare in schedulazione esecutiva
- può stare solo in backlog da preparare
- deve esporre il collo di bottiglia

## 7.4 Bottleneck obbligatori da tracciare

Il sistema **DEVE** distinguere almeno:

- `MATERIAL_MISSING`
- `TOOL_MISSING`
- `PERMIT_MISSING`
- `ACCESS_MISSING`
- `SKILL_MISSING`
- `JOB_PLAN_MISSING`
- `DURATION_UNRELIABLE`

---

# 8. Classi di priorità

## 8.1 Regole

### P1
Usare per:
- safety
- fermo impianto critico
- breakdown grave
- compliance non rinviabile
- rischio danno maggiore imminente

### P2
Usare per:
- correttiva importante
- degrado severo
- rischio escalation nel breve
- perdita produttiva significativa

### P3
Usare per:
- correttiva ordinaria
- guasto non critico ma rilevante
- attività con impatto medio

### P4
Usare per:
- PM
- ispezioni
- attività cicliche pianificate

### P5
Usare per:
- opportunistiche
- migliorative differibili
- richieste a basso impatto

## 8.2 Divieto

Il sistema **NON DEVE** trattare automaticamente ogni ticket ad alta priorità come “da fare subito”.  
Deve sempre considerare anche:

- readiness
- finestra temporale
- disruption cost
- protezione PM
- disponibilità reale

---

# 9. Regole di ingresso nelle finestre

## 9.1 Fascia 0-24h - FROZEN

Possono entrare solo ticket con almeno una delle seguenti condizioni:

- `priority_class = P1`
- rischio safety elevato
- fermo impianto critico
- compliance non rinviabile
- breakdown grave
- indisponibilità improvvisa di risorsa chiave che impone ripianificazione

Il sistema **DEVE**:

- minimizzare i ticket spostati
- registrare motivazione override
- registrare disruption cost
- identificare quali ticket sono stati sacrificati

## 9.2 Fascia 24-48h - PROTECTED

Possono entrare:

- ticket `P1`
- ticket `P2`
- ticket correttivi con alto escalation risk
- ticket con materiali/permessi finalmente disponibili che migliorano il piano

Il sistema **NON DEVE** spostare ticket PM critici salvo override motivato.

## 9.3 Fascia 48-72h - FLEXIBLE

Possono entrare:

- tutti i ticket `READY`
- ticket prioritari
- ticket accorpabili logisticamente
- ticket che migliorano saturazione e produttività

Il sistema **DEVE** favorire:

- cluster per area
- cluster per asset
- cluster per fermata
- continuità tecnica
- riduzione spostamenti

## 9.4 Fascia 72-168h - DYNAMIC

Il sistema **DEVE**:

- riordinare backlog
- allocare nuovi ticket
- preparare le future 48h
- proteggere ticket PM prossimi alla scadenza
- identificare ticket da rendere `READY`

---

# 10. Protezione dei ticket PM

## 10.1 Regola generale

I ticket PM **NON DEVONO** essere spostati se:

- violano la scadenza
- sono legati a compliance
- riguardano asset critici
- il rinvio aumenta il rischio di breakdown
- il rinvio aumenta backlog tecnico pericoloso

## 10.2 Eccezioni

Un ticket PM può essere spostato solo se:

- entra un ticket `P1` reale
- non esistono risorse alternative
- il ritardo resta entro tolleranza definita
- il motivo è tracciato
- il sistema registra impatto e nuova data

## 10.3 Campo obbligatorio

Ogni ticket PM deve esporre:

- `pm_protected = true|false`
- `pm_protection_reason`

---

# 11. Buffer operativo

## 11.1 Regola

Il sistema **DEVE** mantenere buffer di capacità per assorbire il reattivo.

## 11.2 Valori guida

- siti stabili: `5% - 10%`
- siti mediamente reattivi: `10% - 15%`
- siti altamente reattivi o asset critici: `15% - 25%`

## 11.3 Divieto

Il sistema **NON DEVE** saturare rigidamente il 100% delle ore se il contesto richiede buffer.

---

# 12. Disruption Cost

## 12.1 Definizione

Il `disruption_cost` misura il danno causato dall’inserimento o spostamento di un ticket rispetto al piano attuale.

## 12.2 Componenti minime

Il sistema **DEVE** considerare almeno:

- numero ticket spostati
- ore ripianificate
- numero PM spostate
- perdita di continuità sullo stesso asset
- cambio squadra non ottimale
- perdita logistica
- impatto sulla schedule compliance
- violazione di vincoli futuri

## 12.3 Uso obbligatorio

Ogni ticket nuovo o rivalutato **DEVE** essere confrontato con il costo di disruption prima di entrare nel piano.

---

# 13. Insertion Score

## 13.1 Definizione

L’`insertion_score` misura il valore operativo del ticket se inserito nel piano.

## 13.2 Componenti minime

Il sistema **DEVE** considerare almeno:

- priorità
- asset criticality
- safety impact
- production impact
- compliance impact
- escalation risk
- readiness
- accorpabilità
- vicinanza logistica
- opportunità di eseguire altri ticket contestualmente

## 13.3 Regola decisionale

Il ticket entra nel piano se:

`insertion_score > disruption_cost + threshold_finestra`

Dove `threshold_finestra` è più alto nelle finestre più protette e più basso nelle finestre più flessibili.

---

# 14. Soglie per finestra

## 14.1 Regola generale

Il sistema **DEVE** usare soglie diverse per zona temporale.

### `FROZEN_24`
- soglia altissima
- entra quasi solo `P1`

### `PROTECTED_48`
- soglia alta
- entra `P1`, `P2` forti o eccezioni fondate

### `FLEXIBLE_72`
- soglia media
- ottimizzazione guidata da readiness e produttività

### `DYNAMIC_168`
- soglia bassa
- prevale logica di costruzione backlog utile e preparazione

---

# 15. Algoritmo generale

## 15.1 Sequenza obbligatoria

Ad ogni ciclo di pianificazione il sistema **DEVE** eseguire:

1. caricare tutti i ticket aperti
2. aggiornare disponibilità tecnici
3. aggiornare materiali, permessi, accessi e strumenti
4. rivalutare readiness di ogni ticket
5. classificare i ticket per priorità e impatto
6. assegnare la finestra temporale corrente
7. proteggere i ticket PM e compliance
8. calcolare capacità disponibile e buffer
9. valutare ticket già schedulati
10. valutare inserimenti e spostamenti
11. generare piano 7 giorni
12. generare assegnazione giornaliera
13. produrre audit decisionale e KPI

---

# 16. Pseudocodice direttivo

## 16.1 Valutazione readiness

```pseudo
for each ticket in open_tickets:
    if missing_critical_skill(ticket):
        ticket.planning_status = NOT_READY
        ticket.block_reason = SKILL_MISSING
        continue

    if missing_required_material(ticket):
        ticket.planning_status = NOT_READY
        ticket.block_reason = MATERIAL_MISSING
        continue

    if missing_required_access(ticket):
        ticket.planning_status = NOT_READY
        ticket.block_reason = ACCESS_MISSING
        continue

    if missing_required_permit(ticket):
        ticket.planning_status = NOT_READY
        ticket.block_reason = PERMIT_MISSING
        continue

    if missing_job_plan(ticket):
        ticket.planning_status = NOT_READY
        ticket.block_reason = JOB_PLAN_MISSING
        continue

    if estimated_duration_invalid(ticket):
        ticket.planning_status = NOT_READY
        ticket.block_reason = DURATION_UNRELIABLE
        continue

    ticket.planning_status = READY