# UI/UX V3.0 Strategy
## Audit Current UI/UX
L'analisi delle schermate correnti ha evidenziato diverse frizioni operative che rallentano l'utente:

1. **Dashboard (`/dashboard`)**:
   - Visualizzazione densa. Molte informazioni ma poche *azioni*.
   - Frizione: Per agire su un ticket o un asset problematico, l'utente deve navigare fuori dalla dashboard.
   
2. **Pianificazione (`/planning`)**:
   - Il Gantt e le view sono avanzati e funzionali, ma l'azione di "Pianificazione Manuale" apre una modale invadente centrale.
   - Frizione: La modale copre la visibilità del planner. Manca agilità nell'editing inline.

3. **Gestione Ticket (`/ticket`)**:
   - Il cambio di stato è il flusso più comune. Attualmente richiede: Aprire il ticket -> Cercare i campi stato/data esecuzione -> Salvare.
   - Frizione: Modali troppo pesanti (prive di focalizzazione su quick-action).

4. **Navigazione e Creazione**:
   - Manca una via di fuga rapida per inserire segnalazioni. Il tecnico o il responsabile non può creare un ticket "al volo" se si trova in una schermata diversa da `/ticket`.

## Obiettivi e Strategia V3.0
Trasformare l'app in una **Console Operativa "One-Click"**.

### 1. Less Forms, More Context
Eliminare le grandi Dialog e sostituirle con **Drawers (Sheet laterali)**.
Il Drawer scorre da destra, permettendo all'utente di non perdere il contesto della tabella o del Gantt sottostante.

### 2. Global "Quick Ticket"
Inseriremo un'azione globale (es. nella Topbar o come floating button) per aprire un drawer rapido e creare un ticket essenziale in < 10 secondi (solo Titolo, Asset, Priorità).

### 3. Azioni Inline ("One-Click")
Nella DataTable dei Ticket e nel Planner, inseriremo switch e toggle diretti:
- Pulsante `Inizia ora` (Play) direttamente sulla riga del ticket.
- Pulsante `Chiudi/Completa` (Check) diretto.
- Context menu (`...`) per azioni rapide senza aprire dettagli.

### 4. Il "Planner Cockpit"
Il planner rimarrà il cuore. Sarà potenziato togliendo la modale di pianificazione manuale e sostituendola con azioni Drag-and-Drop drag-and-drop arricchite o uno slide-over discreto per l'assegnazione avanzata. Inseriremo inline validation per l'engine AI.
