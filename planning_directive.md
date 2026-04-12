# MaintAI — Planning Directives (v2.6.1)

## 📋 Regole di Pianificazione

### Gestione Ticket Esistenti
- Un ticket è considerato **Locked** se ha `tecnico_id` AND `planned_start` valorizzati.
- Questi ticket NON devono essere ricalcolati o spostati dal motore deterministico.

### Gestione Manuali & Piano
- Ogni manuale PDF caricato DEVE essere associato a un **Piano di Manutenzione**. 
- Durante l'import, il sistema deve persistere sia il record `Manuale` che le `AttivitaManutenzione` (Task) estratte, collegandole permanentemente.
- I task estratti ereditano gli asset associati al Piano al momento della generazione ticket.

### Strategia di Generazione Ticket
- Solo i task in stato `active` possono generare ticket.
- La generazione deve prevenire duplicati: se esiste già un ticket in stato `Aperto`, `Pianificato` o `In corso` per lo stesso task/asset, la generazione viene saltata.
- **Enforcement Stato**: Ogni ticket generato da piano o diagnostica nasce obbligatoriamente in stato `Aperto`.
