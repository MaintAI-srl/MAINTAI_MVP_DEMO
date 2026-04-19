---
name: Planning Engine v3 — pattern di integrazione e hotspot
description: Decisioni architetturali, pattern di integrazione e rischi scoperti durante l'implementazione del Planning Engine v3 (v2.9.0)
type: project
---

## Decisioni implementate in v2.9.0

**Confidence scoring:** implementato nel bridge (`planner_engine_bridge.py`), NON nel motore puro (`planner_engine.py`). Il motore rimane senza dipendenze ORM. Il bridge ha accesso ai dati di contesto (ore_libere, finestre, is_continuation) necessari per il calcolo.

**Deferred WO retrocompatibile:** il campo `reason` (stringa italiana) è mantenuto per retrocompat frontend legacy. I nuovi campi `reason_code`, `reason_detail`, `earliest_possible_date` sono addizionali.

**PannelloMotivazioni era orfano:** il componente esisteva da una versione precedente ma non era importato in page.tsx — bug silente. Fix: import aggiunto + render condizionale quando `efficiency_motivations.length > 0 AND score < 90`.

**_ensure_columns pattern:** per nuove colonne usare sempre il pattern ddl_statements (non Alembic). Per nuove tabelle usare il pattern CREATE TABLE IF NOT EXISTS con varianti PG/SQLite, poi aggiungere `_exec_ddl(pf_pg if pg else pf_sqlite, "nome CREATE")` nel body di `_apply_to`.

**Hotspot conflitti frequenti:**
- `planner_engine_bridge.py` — tocca sia l'engine puro che la logica ORM
- `frontend/app/planning/page.tsx` — tocca UI, stati, handler, import di ogni nuovo componente planning
- `backend/db/modelli.py` + `backend/main.py` — sempre modificati insieme per DDL

**Ordine serializzazione obbligatorio:**
1. modelli.py (ORM)
2. main.py (DDL)
3. planner_engine_bridge.py (logica)
4. planning.py (endpoints)
5. types.ts (tipi TS)
6. componenti nuovi
7. page.tsx (integrazione)

**Why:** ogni step dipende dal precedente. La build TS fallisce se i tipi non sono allineati agli endpoint.

**How to apply:** in task futuri che toccano il planner, sempre serializzare in questo ordine.
