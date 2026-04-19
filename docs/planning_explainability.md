# Planning Explainability — Schema WO v3

Guida ai nuovi campi di explainability nel `plan_json` per utenti e sviluppatori.
Versione: 3.0 (Planning Engine v3, 2026-04-19)

---

## Schema `planned_workorders` — campi v3

```json
{
  "wo_id": 42,
  "technician_id": 3,
  "planned_date": "2026-04-07",
  "time_slot": "08:00-10:00",
  "planned_start_time": "08:00",
  "planned_end_time": "10:00",
  "duration_hours": 2.0,
  "motivation": "Tecnico Mario Rossi assegnato: skill PM disponibile, slot 08:00-10:00 libero",
  "warnings": [],
  "is_continuation": false,
  "parent_wo_id": null,
  "confidence_score": 0.92,
  "risk_level": "LOW",
  "complexity": "STANDARD"
}
```

### Campo `confidence_score`

Valore in `[0.4, 1.0]` che esprime la certezza del motore sull'assegnazione.

Formula di calcolo:
```
conf = 1.0
if is_continuation:        conf *= 0.90  # split su più giorni
if finestra_days <= 2:     conf *= 0.88  # finestra molto stretta
elif finestra_days <= 4:   conf *= 0.94  # finestra stretta
if durata/ore_libere > 0.9: conf *= 0.85 # slot quasi saturo
conf = clamp(conf, 0.40, 1.00)
```

Interpretazione:
| Range | Significato |
|---|---|
| 0.85 - 1.00 | Alta certezza, assegnazione solida |
| 0.65 - 0.84 | Certezza media, possibili margini stretti |
| 0.40 - 0.64 | Bassa certezza, considerare revisione manuale |

### Campo `risk_level`

Derivato da `confidence_score`:
- `LOW` — confidence >= 0.85 (verde)
- `MEDIUM` — confidence >= 0.65 (arancio)
- `HIGH` — confidence < 0.65 (rosso)

### Campo `complexity`

Basato su durata e numero tecnici:
- `SIMPLE` — durata <= 2h e 1 solo tecnico
- `STANDARD` — caso intermedio
- `COMPLEX` — durata > 8h o multi-tecnico

---

## Schema `deferred_workorders` — campi v3

```json
{
  "wo_id": 5,
  "reason": "Nessun tecnico con le competenze richieste disponibile nell'orizzonte",
  "reason_code": "NO_SKILL",
  "reason_detail": "",
  "earliest_possible_date": null
}
```

### Campo `reason_code`

Codice strutturato che identifica il tipo di impedimento:

| Codice | Colore UI | Significato |
|---|---|---|
| `NO_SKILL` | rosso `#ef4444` | Nessun tecnico con la skill richiesta |
| `NO_AVAILABILITY` | grigio `#6b7280` | Tecnico/i assenti per tutto l'orizzonte |
| `TIME_WINDOW_CONFLICT` | ambra `#f59e0b` | Finestra temporale fuori dall'orizzonte |
| `CAPACITY_EXCEEDED` | arancio `#f97316` | Capacità giornaliera esaurita |
| `LIMITATION_MISMATCH` | viola `#a855f7` | Conflitto limitazioni operative |
| `MULTI_TECH_NOT_FOUND` | rosa `#ec4899` | Numero tecnici richiesti non trovato |

### Campo `reason_detail`

Testo tecnico aggiuntivo (es. "Tecnico ID 3 assente dal 2026-04-07 al 2026-04-10"). Può essere vuoto.

### Campo `earliest_possible_date`

Data più vicina in cui il ticket potrebbe essere pianificabile. Attualmente `null` (calcolato in Tier 2).

---

## Componenti UI per Explainability

### `WODetailDrawer`

Drawer slide-in (320px, z-index: 9998) che appare al click su un WO nel Gantt.

Sezioni:
1. Badge tipo (BD/PM/CM) + badge priorità
2. "Motivazione" — testo `wo.motivation` dal motore
3. "Confidence" — barra colorata (verde/arancio/rosso) + percentuale
4. Badge "Risk Level" — LOW/MEDIUM/HIGH
5. Badge "Complexity" — SIMPLE/STANDARD/COMPLEX
6. "Tecnico" — nome e competenze
7. "Slot" — data, orario, durata
8. "Warnings" — lista warning se non vuota

### `PannelloMotivazioni`

Pannello che appare automaticamente nella sidebar sinistra quando `efficiency_score < 90`.
Mostra le motivazioni per ogni componente del punteggio di efficienza sotto target.

### `DeferredWOPanel` (Tier 2)

Pannello con lista WO non pianificati, filtrabili per `reason_code`, con badge colorati.

---

## Plan Metadata (Tier 2)

Campo aggiunto al `plan_json` dopo la generazione:

```json
{
  "plan_metadata": {
    "engine_version": "3.0",
    "generated_by": "deterministic",
    "generation_time_ms": 45,
    "confidence_avg": 0.88
  }
}
```

`confidence_avg` esclude le continuazioni dal calcolo della media.
