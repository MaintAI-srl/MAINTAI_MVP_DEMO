# MaintAI — Planning Directives (v2.6.0)

## 📋 Regole di Pianificazione

### Gestione Ticket Esistenti
- Un ticket è considerato **Locked** se ha `tecnico_id` AND `planned_start` valorizzati.
- Questi ticket NON devono essere ricalcolati o spostati dal motore deterministico.

### Matching Competenze
- Utilizzare i tipi manutenzione (`PM`, `CM`, `BD`) come competenze implicite se il tecnico non ha competenze specifiche mappate nel DB.
- Se presenti, le competenze reali hanno la precedenza assoluta.

### Gestione Manuali & Task
- Ogni task estratto da un manuale deve essere collegato a un **Piano di Manutenzione** specifico.
- Non caricare mai manuali orfani.
- I manuali caricati vengono processati per estrarre task con frequenza e priorità.

### Strategia di Generazione Ticket
- Solo i task in stato `active` possono generare ticket.
- La generazione deve prevenire duplicati: se esiste già un ticket in stato `Aperto`, `Pianificato` o `In corso` per lo stesso task/asset, la generazione viene saltata con warning.
- Stato di default del nuovo ticket: `Aperto`.
