# MaintAI — Architettura di Sistema (v2.6.0)

## 🏢 Backend (FastAPI + SQLAlchemy)

### Struttura Repository
- **AssetRepository**: Gestisce la logica di ricerca massiva con supporto a `ILIKE` e filtri gerarchici (Sito -> Impianto -> Asset).
- **PianoRepository**: Gestisce l'associazione Many-to-Many tra Piani e Asset.

### Gestione Dati
- **Ticket Generation**: I ticket vengono generati in stato `Aperto`. Se la durata supera le 8h, vengono splittati automaticamente in "parti" da max 8h.
- **Auto-codifica**: I piani seguono il formato `PM-YYYY-NNN` con gestione della concorrenza tramite loop di unicità.

## 🎨 Frontend (Next.js + Tailwind)

### Layout 3-Panel
Implementato nel modulo Piani per efficienza industriale:
1. **Sidebar Sidebar**: Lista entità principali (Piani/Asset).
2. **Dynamic Header**: Mostra metadati contestuali e KPI veloci.
3. **Tabbed Content area**: Organizzazione delle sottomodulistiche (Task, Documenti, History).

### Componenti Core
- **ScalableAssetSelector**: Componente asincrono per la selezione di entità in set di dati massivi.
- **StatusToggle**: Pulsanti ad azione singola (1-click) invece di dropdown per cambi di stato rapidi.

## 🤖 AI Engine
- **PDF Extraction**: Processamento asincrono di manuali tramite GPT-4.1-mini per l'estrazione di task tabellari.
- **RCA/Problem Analysis**: Tool interattivo per il supporto decisionale al manutentore.
