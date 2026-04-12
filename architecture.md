# MaintAI — Architettura di Sistema (v2.6.1)

## 🏢 Backend (FastAPI + SQLAlchemy)

### Struttura Repository & Piani
- **AssetRepository**: Gestisce la logica di ricerca massiva con supporto a `ILIKE` e filtri gerarchici.
- **PianoRepository**: Gestisce l'associazione Many-to-Many tra Piani e Asset. Un Piano è un contenitore logico di attività applicabili a uno o più asset.

### Gestione Dati e Documenti
- **Persistence**: Ogni manuale PDF caricato in un piano viene salvato come record `Manuale` con associazione `piano_id`.
- **Ticket Generation**: Ticket generati sempre in stato `Aperto` (o `Pianificato` se processati dallo scheduler). Splitting automatico sopra le 8h.
- **Auto-codifica**: Formato `PM-YYYY-NNN` con gestione unicità globale per tenant.

## 🎨 Frontend (Next.js + Tailwind)

### Layout 3-Panel (Standard Industriale)
Struttura a zero-click per massimizzare la velocità:
1. **Nav Sidebar**: Lista entità ricercabile.
2. **Context Header**: Titoli 48px, KPI (Ticket Aperti, Task Totali).
3. **Tabbed Content**: Area operativa (Attività, Manuali, Cronologia).

### Componenti Core
- **BulkSelector**: Gestione asincrona del caricamento asset (>50 entità per view).
- **Leggibilità**: Font-size minimo 14px, contrasto elevato per tablet industriali.
