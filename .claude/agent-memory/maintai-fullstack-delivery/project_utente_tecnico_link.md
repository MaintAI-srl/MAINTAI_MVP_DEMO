---
name: Utente-Tecnico link pattern
description: Pattern di collegamento Utente↔Tecnico: FK nullable utente_id su Tecnico, joinedload per utente_username, validazione unicità collegamento nel PUT /tecnici
type: project
---

Il collegamento Utente↔Tecnico usa `Tecnico.utente_id` (FK nullable verso `utenti.id`, già in DB).

Punti chiave:
- `tecnico_repository._to_dict()` legge `tecnico.utente.username` via relazione ORM — richiede `joinedload(Tecnico.utente)` su tutte le query per evitare N+1
- Dopo `db.commit()` + `db.refresh()`, fare una query separata con `joinedload` per riavere l'oggetto con utente caricato
- `PUT /tecnici/{id}` valida che `utente_id` appartenga allo stesso tenant E non sia già collegato ad altro tecnico (409 in caso)
- `TecnicoCreate` include `utente_id: Optional[int] = None`
- `TecnicoResponse` include `utente_id` e `utente_username`

**Endpoint `/utenti`** (route `backend/api/routes/utenti.py`):
- `GET /utenti` — lista utenti del tenant, accessibile a `responsabile` + `superadmin`
- `POST /utenti` — crea utente nel tenant corrente (responsabile può creare tecnico/responsabile)
- `PUT /utenti/{id}/password` — reset password con invalidazione JWT (token_version++)
- `PUT /utenti/{id}/toggle-active` — attiva/disattiva utente con invalidazione JWT

**Why:** La pagina `/tecnici` e `/admin/utenti` richiedevano questi endpoint per collegare account operativi ai profili tecnici fisici.

**How to apply:** Quando si aggiungono campi di FK opzionale su modelli esistenti, ricordarsi di aggiornare `_to_dict`, le query con `joinedload`, i Pydantic schema Create/Update/Response, e validare ownership nel layer route.
