# Design System V3.0

MaintAI V3 uniforma e compatta la UI utilizzando **Tailwind CSS v4** e i componenti di base di **shadcn/ui**. L'estetica premium industrial-dark rimane il core, ma elevata all'ennesima potenza.

## Colori (Tokens Principali)
*   `--background`: `slate-950` (#020617) - Sfondo app, il buio più profondo per focus
*   `--card`: `slate-900` (#0f172a) o Gradient `145deg, #0f172a, #1e293b`
*   `--primary`: `blue-500` (#3b82f6) - Azioni principali
*   `--muted`: `slate-800` (#1e293b) - Elementi secondari
*   `--border`: `slate-800` / `slate-700`

## Tipografia
*   **Headings / Display**: `Barlow Condensed` (es. `font-display`, `tracking-tight`), peso 700/800 per KPI, Titoli di modulo.
*   **Body**: `Barlow` o `Geist` per la leggibilità del content e label.
*   **Codici/Dati**: `JetBrains Mono` (`font-mono`) per codici asset, date esatte, valori tecnici.

## Componenti Shadcn Core da Utilizzare
1.  **Sheet (Drawer)**
    *   *Uso:* Sostituisce i Dialog enormi per i dettagli dei ticket o i form estesi. 
    *   *Stile:* Bordo `slate-800`, overlay `backdrop-blur-sm`.
2.  **DropdownMenu**
    *   *Uso:* Per le azioni contestuali (`...`) nelle tabelle o sulle KPI card, riducendo l'ingombro.
3.  **Badge**
    *   *Stile Premium:* Sfondo debole al 10/15% con bordo in tinta opaco. Evitare i solid background tranne per check e alert vitali. Tag per Priorità, Tipo (BD, PM, CM).
4.  **Button**
    *   *Uso:* Size compatta (`sm`) per table data e inline list. I rounded devono essere coerenti (`border-radius: 6px` per interfacce agili).

## Interazione & Animazione
*   Micro-interazioni: Gli hover su righe, row cards, e block planner avranno lievi traslazioni in-y o cambi leggeri di `bg-hover` e box shadow interno (`inset`) minimali per restituire al tatto virtuale la *sensazione "console"*.
