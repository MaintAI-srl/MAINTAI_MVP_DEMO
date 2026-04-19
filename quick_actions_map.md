# Mappa Azioni Rapide (Quick Actions Map)

Questa mappa definisce le azioni "One-Click" e la loro locazione all'interno dell'interfaccia V3.0, pensata per eliminare i colli di bottiglia operativi.

## 1. Topbar (Globale)
- **[+] Quick Ticket**: Apre uno Sheet laterale "Nuovo Ticket". Accessibile da *qualsiasi* pagina. Crea un ticket essenziale (Titolo, Asset, Tipo) in pochi secondi.

## 2. Modulo Ticket (`/ticket`)
### Sulla Tabella (Riga singola):
- **Play (Inizia Intervento)**: Cliccabile se lo stato è `Aperto` o `Pianificato`. Sposta istantaneamente lo stato in `In Corso` impostando `execution_start = now`.
- **Stop/Check (Completa)**: Cliccabile se lo stato è `In Corso`. Apre la dialog di check conclusivo (verifica stato asset) e chiude.
- **Assegna (...)**: Menu a tendina leggero (shadcn DropdownMenu) per l'assegnazione rapida tecnico.

### Sezione Dettaglio (Sostituzione Dialog -> Drawer):
- Cliccando la riga si apre il **TicketDetailDrawer** (da destra).
- La formattazione non è più form-centrica ma visuale, con azioni primarie in basso fisse (Sticky actions: "Salva", "Concludi").

## 3. Dashboard (`/dashboard`)
- **Click su KPI "Ticket Aperti" o "Guasti"**: Al posto del redirect crudo verso la pagina lista, apre uno Sheet laterale con la preview della lista interessata e inline actions (es. "Quick Assign"), riducendo la frizione cognitiva del cambio contesto. 

## 4. Planner (`/planning`)
- **Drag & Drop as is**, ma la transizione da "Unscheduled" a "Scheduled" usa l'engine senza blocchi visuali modali se non necessario.
- **Context Action su Ticket-Block**: Click destro (o long press) sul block del Gantt apre mini-context menu (Elimina dal piano, Sposta al giorno successivo, Check as done).
