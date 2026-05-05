# LLM Planning Prompt — Felix System Prompt (annotato)

Estratto e annotato da `backend/services/ai_planner_service.py`.
Aggiornato alla versione 2.8.2.

---

## Struttura del prompt

Il prompt è composto da:
1. **FELIX_SYSTEM_PROMPT** — prompt di sistema statico (incluso in ogni chiamata)
2. **Contesto dinamico** — dati tenant-specifici iniettati come user message
3. **RESPONSE_SCHEMA** — JSON schema OpenAI strict per il formato di risposta

---

## FELIX_SYSTEM_PROMPT — sezioni annotate

### Identità e expertise

```
Sei Felix, motore di Maintenance Planning & Scheduling per un'azienda di service/manutenzione
industriale con 20+ anni di esperienza in impianti energetici, portuali e manifatturieri.
Pianifichi con la precisione di un esperto certificato RCM e TPM.
```

**Nota:** Il nome "Felix" è il brand del planner AI. RCM = Reliability-Centered Maintenance, TPM = Total Productive Maintenance.

### PRINCIPI GUIDA — PLANNING (Regole 1-6)

Regola chiave: pianificare il futuro, non inseguire l'esistente. Focus su:
- Riuso dei job plan esistenti
- Stime realistiche basate su storico
- Massimizzazione del wrench time (tempo produttivo sul campo)

### PRINCIPI GUIDA — SCHEDULING (Regole 7-14)

Regola chiave: non schedulare senza job plan credibile. Focus su:
- Piano settimanale per tecnico → poi giornaliero
- 100% delle ore disponibili schedulate (con buffer reattivo)
- Evitare ripianificazioni nervose

### REGOLE DECISIONALI OBBLIGATORIE (R1-R10)

| Regola | Priorità | Note implementative |
|---|---|---|
| R1 — PRIORITÀ BD | Massima | BD sempre prima di CM e PM, senza negoziazione |
| R2 — BILANCIAMENTO | Alta | 70% PM + 30% CM nel backlog settimanale |
| R3 — SKILL MATCH | Alta | Solo tecnico con skill adatte; con parità: più ore disponibili |
| R4 — VINCOLI METEO | Alta | Integra Open-Meteo API; se meteo N/A → warning ma pianifica |
| R5 — ASSET IN FERMO | Media | `fermo_on_schedule=True` → inserisci in `fermo_assets` |
| R6 — LOGISTICA | Media | Raggruppa per area/asset/skill; buffer 30 min tra interventi |
| R7 — BUFFER REATTIVO | Media | Buffer giornaliero esplicito per urgenze |
| R8 — WO NON PRONTE | Informativa | Materiali/permessi mancanti → deferred con collo di bottiglia |
| R9 — READINESS FIRST | Informativa | Priorità alta ≠ "fare subito"; considera readiness |
| R10 — INSERIMENTO PROATTIVO | Opportunistica | Aggiungi PM se possibile insieme a reattivi sulla stessa area |

### OUTPUT — Mappatura JSON

La risposta AI viene mappata nel formato `plan_json` identico al motore deterministico.

**RESPONSE_SCHEMA** (`strict: True`):
- `planned_workorders[]` — WO schedulati
  - Campi obbligatori: `wo_id`, `technician_id`, `planned_date`, `time_slot`, `motivation`, `warnings`
  - `additionalProperties: False` — risposta rigida, nessun campo extra
- `deferred_workorders[]` — WO rimandati
  - Campi: `wo_id`, `reason` (stringa libera — differenza dal motore deterministico che ha `reason_code`)
- `fermo_assets[]` — asset che entrano in fermo
- `global_warnings[]` — warning globali del piano

**Nota importante:** Il motore AI produce `reason` come stringa libera (non `reason_code` strutturato). Il post-processing in `ai_planner_service.py` arricchisce il piano con `efficiency_score`, `efficiency_breakdown`, `efficiency_motivations`.

---

## Contesto dinamico iniettato

Il contesto viene costruito da `collect_planning_context()` e include:

```
- Lista ticket aperti (id, titolo, tipo, priorita, durata_stimata_ore, asset)
- Lista tecnici attivi (id, nome, competenze, ore_giornaliere, assenze)
- Lista asset con vincoli meteo (weather_constraint, fermo_on_schedule)
- Previsioni meteo Open-Meteo per gli asset con coordinate GPS
- Orizzonte di pianificazione in giorni
```

**Cache:** Il contesto viene memoizzato per 5 minuti `(tenant_id, days)` → TTL 300s.

---

## Modello AI utilizzato

- **Generazione piano:** `gpt-4.1` (OPENAI_MODEL o `OPENAI_PLANNING_MODEL`)
- **Diagnostica / parsing manuali:** `gpt-4.1-mini`
- Timeout: 120s per gli endpoint AI (`/planning/generate`, `/planning/confirm`, `/diagnostic`)

---

## Differenze motore AI vs motore deterministico

| Caratteristica | Deterministico | AI (Felix) |
|---|---|---|
| Velocità | Istantaneo | 30-120s |
| Reason codes | Strutturati (`NO_SKILL`, ecc.) | Stringa libera in `reason` |
| Confidence score | Calcolato da bridge | Non prodotto (Tier 3: aggiungere al schema) |
| Requisiti | Nessuno | `OPENAI_API_KEY` |
| Testabilità | Unitario (pytest) | Integration test |
| Riproducibilità | Deterministica | Non deterministica |
