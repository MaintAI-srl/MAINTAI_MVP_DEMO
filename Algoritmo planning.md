# Algoritmo planning — Auto-scheduling ticket (saturazione ore)

Documento di riferimento per la feature **Generazione piano** di MaintAI.

> Implementazione: `backend/services/auto_scheduler.py` (motore puro, testabile) +
> `backend/services/auto_scheduler_bridge.py` (adattatore ORM → `plan_json`).
> Esposto da `POST /planning/generate` con `mode="deterministic"` e attivato dal
> pulsante **Generazione piano** nella pagina `/planning`.

---

## 1. Obiettivo

Assegnare automaticamente i ticket manutentivi disponibili ai tecnici **cercando di
occupare il più possibile le ore lavorative disponibili** di ogni tecnico, sia su
base giornaliera sia su base settimanale.

**Fuori scope (esclusi volutamente):**

- SLA, penali, scadenze contrattuali.
- Decisione affidata a un LLM. La logica di scheduling è **deterministica e
  ripetibile**: vive nel codice. L'AI può solo (in futuro) spiegare, riassumere o
  suggerire — mai decidere.

---

## 2. Planning vs Scheduling

| Fase | Responsabilità |
|---|---|
| **Planning** | Il ticket è già pronto: descrizione, sito, asset (se presente), durata stimata, skill richiesta, eventuale priorità tecnica, stato, finestra di accesso, materiali. |
| **Scheduling** | L'algoritmo decide: **quale tecnico**, **in quale giorno**, **a quale ora**, **in quale ordine**, e **come riempire** al meglio giornata e settimana. |

---

## 3. Requisiti principali

1. **No weekend** — si pianifica solo Lun–Ven. Sabato e domenica vengono saltati.
2. **Saturazione ore** — massimizzare il riempimento della capacità (es. 8h/giorno,
   40h/settimana) senza superarla.
3. **No overbooking** — un tecnico non ha mai ticket sovrapposti; un ticket va a un
   solo tecnico.
4. **No straordinario (MVP)** — non si supera l'orario di fine giornata né la
   capacità giornaliera/settimanale.

---

## 4. Campi minimi

### Ticket (mappatura su MaintAI)

| Campo logico | Campo MaintAI | Note |
|---|---|---|
| `id` | `Ticket.id` | |
| `title` | `Ticket.titolo` | |
| `site_id` | `Asset.impianto_id` | usato per il raggruppamento per sito |
| `asset_id` | `Ticket.asset_id` | opzionale |
| `status` | `Ticket.stato` | schedulabile se `Aperto`/`Pianificato` |
| `required_skill` | `Ticket.competenza_richiesta` → fallback `Ticket.tipo` (PM/CM/BD) | |
| `estimated_duration_minutes` | `Ticket.durata_stimata_ore × 60` | default 2h se mancante |
| `priority` | `Ticket.priorita` | **NON** è SLA: serve solo per l'ordinamento |
| `asset_criticality` | `Asset.criticita` (A/B/C) | |
| `materials_ready` | `not Ticket.in_attesa_ricambio` | |
| `access_window_*` | — | opzionale, nessun vincolo se assente |
| `scheduled_start/finish` | `Ticket.planned_start/finish` | scritti alla conferma |
| `assigned_technician_id` | `Ticket.tecnico_id` | scritto alla conferma |

### Tecnico

| Campo logico | Campo MaintAI |
|---|---|
| `id` / `name` | `Tecnico.id` / `nome cognome` |
| `skills` | `Tecnico.competenze` (PM/CM/BD aggiunte implicitamente se nessuna job-skill) |
| `workday_start/end` | `Tecnico.orario_inizio/orario_fine` |
| `daily_capacity_minutes` | `Tecnico.ore_giornaliere × 60` |
| `weekly_capacity_minutes` | `daily_capacity_minutes × 5` |
| `active` | `Tecnico.stato == "in servizio"` |
| assenze | `TecnicoAssenza` → `absent_days` |

### Blocco calendario

`technician_id, ticket_id, start, end, duration_minutes, type, source, status`
con `type ∈ {TICKET, PAUSA, BLOCCO, FERIE, ALTRO}`, `source ∈ {MANUAL, AUTO}`,
`status ∈ {PROPOSED, CONFIRMED}`. I ticket già pianificati/manuali entrano come
blocchi `CONFIRMED/MANUAL` e occupano capacità.

---

## 5. Funzione principale

```python
auto_schedule_tickets(
    tickets, technicians, calendar_blocks,
    start_date, end_date,
    include_weekends=False, mode="weekly_fill",
)
```

1. Filtra i ticket schedulabili (`is_ticket_schedulable`).
2. Calcola lo score di ogni ticket (`calculate_ticket_score`) e li ordina.
3. Genera i giorni lavorativi (`get_working_days`, no weekend).
4. Costruisce la disponibilità dei tecnici (`build_technician_availability`):
   capacità teorica − blocchi esistenti = slot liberi.
5. Assegnazione **greedy**: per ogni ticket sceglie il miglior `(tecnico, slot)`
   per `SlotScore`, riserva lo slot e aggiorna il calendario.
6. Restituisce `assignments`, `excluded` (con reason code) e `summary` (KPI).

---

## 6. Ordinamento ticket — `TicketScore`

```
TicketScore = priorità tecnica + criticità asset + aging + rarità skill + durata utile
```

| Componente | Pesi |
|---|---|
| Priorità | Alta +40 · Media +20 · Bassa +5 |
| Criticità asset | A/Alta +30 · B/Media +15 · C/Bassa +0 |
| Aging | > 7gg +15 · > 3gg +10 · nuovo +0 |
| Rarità skill | skill rara (≤ 1 tecnico la possiede) +15 · comune +0 |
| Durata utile | `min(durata_h, 8) × 2` (max +16) — i ticket lunghi prima, riempiono meglio |

A parità di score: prima i più vecchi, poi i più lunghi, poi per `id` (determinismo).

---

## 7. Scoring slot — `SlotScore`

```
SlotScore = skill_match + fill_score + daily_balance + weekly_balance
            + site_grouping − fragmentation_penalty
```

| Componente | Pesi |
|---|---|
| **skill_match** | skill esatta (job-skill) +30 · skill generica (PM/CM/BD) +15 |
| **fill_score** | residuo slot = 0 → +30 · ≤ 30min → +20 · ≤ 60min → +10 · oltre +0 |
| **daily_balance** | saturazione giorno < 50% +20 · 50–80% +10 · > 80% +0 |
| **weekly_balance** | saturazione settimana < 50% +20 · 50–80% +10 · > 80% +0 |
| **site_grouping** | stesso sito già presidiato in giornata +20 · sede base del tecnico +10 |
| **fragmentation_penalty** | buco residuo > 120min −10 · 60–120min −5 · < 60min 0 |

**Overtime** = hard constraint: se l'intervento supera l'orario di fine giornata la
proposta viene **scartata** (non penalizzata).

---

## 8. Vincoli

**Hard (scartano sempre la proposta):** weekend; tecnico senza skill; slot di durata
insufficiente; sovrapposizione con altro blocco; superamento orario/capacità;
materiali necessari non pronti; ticket chiuso/annullato.

**Soft (ottimizzano, non bloccano):** saturazione giornaliera/settimanale;
accorpamento per sito; riduzione buchi; distribuzione del carico; ticket più vecchi;
priorità tecnica; criticità asset.

---

## 9. Esclusioni — reason code

| Codice | Significato |
|---|---|
| `NON_SCHEDULABILE_DATI_MANCANTI` | manca durata, sito/asset o skill richiesta |
| `NON_SCHEDULABILE_SKILL_ASSENTE` | nessun tecnico con la skill richiesta |
| `NON_SCHEDULABILE_SLOT_ASSENTE` | nessuno slot disponibile nel periodo |
| `NON_SCHEDULABILE_MATERIALI` | materiali non pronti (intervento bloccato) |
| `NON_SCHEDULABILE_STATO` | stato ticket non compatibile con lo scheduling |

---

## 10. Output

```json
{
  "assignments": [
    {
      "ticket_id": 104, "technician_id": 3,
      "start": "2026-06-17T08:00:00", "end": "2026-06-17T10:00:00",
      "duration_minutes": 120, "score": 85,
      "reason": "Ticket #104 assegnato a Luca il 17/06/2026 dalle 08:00 alle 10:00. Motivi: ..."
    }
  ],
  "excluded": [{ "ticket_id": 202, "reason": "NON_SCHEDULABILE_SKILL_ASSENTE" }],
  "summary": {
    "total_tickets_analyzed": 25, "tickets_scheduled": 18, "tickets_excluded": 7,
    "daily_utilization_percent": 84.7, "weekly_utilization_percent": 80.0,
    "utilization_percent": 80.0,
    "technicians": [{ "technician_id": 3, "name": "Luca", "scheduled_minutes": 2280,
                      "capacity_minutes": 2400, "utilization_percent": 95.0, "saturo": true }],
    "technicians_saturated": 1, "technicians_undersaturated": 2
  }
}
```

Il bridge converte questo risultato nel formato `plan_json` standard
(`planned_workorders` / `deferred_workorders`) compatibile con Gantt, conferma e
badge efficienza, aggiungendo la chiave `scheduling_summary` per i KPI in UI.

---

## 11. UI

Pulsante **Generazione piano** nell'header di `/planning` (senza la parola «AI»),
con selettore orizzonte (7/14/30 gg) e selettore modalità:

- **Proposta** (default): crea una bozza (`status = draft`, blocchi `PROPOSED`)
  visibile sul Gantt, da rivedere e confermare manualmente.
- **Conferma auto**: genera e conferma subito il piano (ticket → `Pianificato`,
  tecnico assegnato, `planned_start/finish` scritti).

Al termine viene mostrato un riepilogo KPI: ticket analizzati/schedulati/esclusi,
saturazione giornaliera/settimanale/periodo e saturazione per tecnico.

---

## 12. Criteri di accettazione

L'algoritmo è accettabile se:

- non pianifica mai sabato/domenica;
- non assegna ticket a tecnici senza skill compatibile;
- non crea sovrapposizioni;
- non supera l'orario/capacità del tecnico;
- riempie il più possibile le ore disponibili;
- produce un riepilogo di saturazione giornaliera e settimanale;
- spiega perché un ticket è (o non è) stato assegnato;
- funziona anche con ticket incompleti (li esclude con motivazione);
- lascia al planner la possibilità di confermare o modificare.

Test: `backend/tests/test_auto_scheduler.py`.

> **Nota AI** — In questa versione le chiamate AI sono disattivate: il pulsante usa
> esclusivamente il motore deterministico. La generazione AI (`mode="ai"`) resta
> dietro il feature flag `AI_PLANNING_ENABLED`.
