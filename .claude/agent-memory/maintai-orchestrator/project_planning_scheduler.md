---
name: Struttura pagine planning e scheduler
description: Mappa delle pagine /planning e /scheduler con ruoli e relazioni, post-unificazione v2.8.3
type: project
---

/planning/page.tsx — Pagina principale Piano AI con Gantt/Kanban/Calendario, backlog, conferma piano, storico, motore deterministico + GPT. Titolo UI: "Piano di Manutenzione AI" (rimosso "MARCO" in v2.8.3).

/planning/risorse/page.tsx — Pagina Scheduler Risorse con vista Giorno/Settimana/2Settimane, drag-and-drop ticket su timeline per tecnico. Linkata in sidebar come "Scheduler" → /planning/risorse.

/scheduler/page.tsx — Puro redirect a /planning per retrocompatibilità. Nessuna logica propria. Da tenere.

/scheduler/DashboardComponents.tsx, unified_types.ts, unified_helpers.ts — Codice morto: non importato da nessuna pagina attiva. Esiste ancora ma non serve.

Sidebar NAV (layout.tsx): sezione VISUALIZZAZIONI ha "Piano AI" → /planning e "Scheduler" → /planning/risorse. NON c'è più una voce che punta a /scheduler.

**Why:** Il task v2.8.3 chiedeva di unire /scheduler in /planning, ma la vera logica scheduler era già in /planning/risorse. I file /scheduler/* sono codice legacy/morto.

**How to apply:** Se in futuro si vuole rimuovere /scheduler/, i file da eliminare sono solo: page.tsx (redirect), DashboardComponents.tsx, unified_types.ts, unified_helpers.ts. Non toccare /planning/risorse/.
