# Planning Rules — MaintAI PlannerEngine v3

Estratto dal codice reale (`planner_engine.py`, `planner_engine_bridge.py`).
Aggiornato alla versione 2.8.2.

---

## Hard Constraints (violazioni → WO deferito)

| Regola | Codice | Implementazione |
|---|---|---|
| Tecnico deve avere la skill richiesta | `NO_SKILL` | `competenza_richiesta` (o `tipo` come proxy) deve essere in `tecnico.competenze` |
| Tecnico deve essere disponibile (non assente) | `NO_AVAILABILITY` | `giorno not in tecnico.giorni_assenza` |
| Finestra temporale del ticket deve rientrare nell'orizzonte | `TIME_WINDOW_CONFLICT` | `finestra_inizio <= today + horizon` e `finestra_fine >= today` |
| Capacità giornaliera non superata | `CAPACITY_EXCEEDED` | `ore_consumate[tecnico][giorno] + durata <= ore_giornaliere` |
| Limitazioni operative compatibili | `LIMITATION_MISMATCH` | `ticket.limitazioni` e `tecnico.limitazioni` non devono conflittare |
| Numero tecnici richiesti disponibile | `MULTI_TECH_NOT_FOUND` | `tecnici_richiesti` tecnici con skill disponibili nello stesso slot |

## Soft Constraints (violazioni → warning nel WO, non deferito)

- Preferenza per tecnico già assegnato a ticket correlati sullo stesso asset
- Bilanciamento carico tra tecnici (target 70%+ saturazione per il tecnico più carico)
- Rispetto delle fasce orarie preferite (orario_inizio / orario_fine tecnico)
- Priorità Alta schedulata prima di Media e Bassa
- Ticket con scadenza SLA schedulati entro la scadenza

## Reason Codes

```python
REASON_NO_SKILL              = "NO_SKILL"
REASON_NO_AVAILABILITY       = "NO_AVAILABILITY"
REASON_TIME_WINDOW_CONFLICT  = "TIME_WINDOW_CONFLICT"
REASON_CAPACITY_EXCEEDED     = "CAPACITY_EXCEEDED"
REASON_LIMITATION_MISMATCH   = "LIMITATION_MISMATCH"
REASON_MULTI_TECH_NOT_FOUND  = "MULTI_TECH_NOT_FOUND"
```

Priorità di valutazione (il primo reason code rilevato vince):
```
NO_SKILL > LIMITATION_MISMATCH > TIME_WINDOW_CONFLICT > MULTI_TECH_NOT_FOUND > CAPACITY_EXCEEDED > NO_AVAILABILITY
```

Traduzione italiana (da `REASON_IT` in `planner_engine_bridge.py`):
| Codice | Messaggio |
|---|---|
| `NO_SKILL` | "Nessun tecnico con le competenze richieste disponibile nell'orizzonte" |
| `NO_AVAILABILITY` | "Nessuna disponibilità nel periodo pianificato" |
| `TIME_WINDOW_CONFLICT` | "Finestra temporale fuori dall'orizzonte di pianificazione" |
| `CAPACITY_EXCEEDED` | "Capacità giornaliera dei tecnici esaurita nell'orizzonte" |
| `LIMITATION_MISMATCH` | "Conflitto tra limitazioni operative del ticket e del tecnico" |
| `MULTI_TECH_NOT_FOUND` | "Non trovato il numero richiesto di tecnici qualificati" |

## Locked Ticket Logic

Un ticket è **locked** (non viene ripianificato dal motore) se:
- `tecnico_id IS NOT NULL` AND `planned_start IS NOT NULL`, OPPURE
- `is_manual_plan = True`

I ticket locked concorrono al consumo di capacità giornaliera dei tecnici ma non vengono modificati.

Quando un ticket torna ad `"Aperto"` (via UI), `planned_start` e `planned_finish` vengono azzerati a `null` → il ticket diventa pianificabile di nuovo.

## Workaround Skill Implicite

Finché il campo `Ticket.competenza_richiesta` non è valorizzato, il bridge aggiunge automaticamente `["PM", "CM", "BD"]` come competenze implicite a ogni tecnico attivo (`_TIPO_IMPLICITI`). Questo evita che tutti i ticket vengano deferiti per `NO_SKILL` nei deployment dove i tecnici hanno solo job-skill (es. "Meccanico", "Elettricista").

Con il campo `competenza_richiesta` valorizzato, il matching è esplicito e il workaround non impatta il risultato.

## Splitting WO

Se un ticket supera la capacità residua di una giornata ma `splittabile=True`, il motore crea una continuazione:
- WO principale: `is_continuation=False`, `parent_wo_id=None`
- WO continuazione: `is_continuation=True`, `parent_wo_id=<id_principale>`

Le continuazioni non vengono conteggiate nel `wo_count` del piano alla conferma.

## Fermo Asset

Se `asset.fermo_on_schedule=True`, alla conferma del piano l'asset viene portato in stato `"Fermo"`. Questo viene tracciato in `plan_json.fermo_assets`.
