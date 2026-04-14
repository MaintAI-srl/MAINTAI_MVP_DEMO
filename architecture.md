# MaintAI — Architettura di Sistema (v2.8.1)

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
- **NotificationPanel**: Caricamento iniziale differito di 4s (per non colpire Render cold start al primo paint).

### Scheduler Risorse (`/planning/risorse`)
- Timeline Day/Week/2Week con DnD drag-and-drop.
- Day view: 00:00→24:00 (HOUR_W=80px × 24 = 1920px, scroll orizzontale).
- Week view: Lun–Dom (7 giorni), 2Week: 14 giorni.
- Tecnici filtrati per `stato === "in servizio"`.

### Tecnico API Shape
- Backend `_to_dict` restituisce `skill` (non `competenze`).
- `TecnicoData.skill?: string` aggiunto per compatibilità con `tecnici/page.tsx` che usa `t.skill`.
