# MaintAI — Direttive di Sviluppo (v2.8.1)

Queste direttive devono essere lette e applicate rigorosamente ad ogni sessione di sviluppo.

## 🎨 Design & UI/UX (Leggibilità Industriale)
- **Operatività Reale**: Le interfacce devono essere leggibili in ambiente industriale. 
- **Font & Dimensioni**: 
  - **Standard Base**: `text-sm` (14px). Mai scendere sotto i 12px per contenuti leggibili.
  - **Titoli**: Usare gerarchia forte (`text-2xl` a `text-5xl`).
  - **Contrasti**: Sfondi scuri (#030712) con testi bianchi o indigo-400 ad alto contrasto.
- **Layout 3-Panel**: Obbligatorio per i moduli core (Piani, Asset, Ticket). 
- **Micro-interazioni**: Feedback visivo immediato (spinner, toast) per caricamenti e upload.

## 💻 Codice & Architettura
- **Robustezza API**: Ogni endpoint di lista DEVE supportare `limit` fino a 1000 per dataset reali.
- **Import/Schema**: Verificare sempre gli import `typing` (es. `Optional`, `List`) per evitare NameError a runtime.
- **Persistenza Documentale**: I manuali PDF caricati dentro un contesto (es. Piano) devono essere salvati nel DB e collegati permanentemente.

## 💡 Naming Fields Backend→Frontend
- Il backend (`tecnico_repository._to_dict`) restituisce `skill` (non `competenze`). Il tipo `TecnicoData` ha entrambi (`competenze` legacy + `skill?: string`). Usare sempre `(t as any).skill ?? t.competenze` per rendering sicuro.
- Il campo `stato` dei tecnici attivi è `"in servizio"` (non `"attivo"`). Filtrare sempre con `t.stato === "in servizio"`.

## 🕐 Planning Scheduler (risorse/page.tsx)
- Vista giorno: DAY_START_H=0, DAY_END_H=24 (full day, scroll orizzontale).
- Vista settimana: 7 giorni Lun–Dom (count=7), non 5 giorni lavorativi.
- Vista 2settimane: 14 giorni (count=14).

## 🚀 Regole Operative
- **P0 Priority**: In caso di incidente operativo, la priorità è la STABILIZZAZIONE delle funzioni core rispetto all'estetica.
- **Autonomia**: Procedere fino a completamento se richiesto, garantendo test di integrazione silenti.
- **Auto-Miglioramento**: Al termine di ogni ciclo, aggiornare i file di direttiva per riflettere le nuove best-practice scoperte.
- **Desktop Startup**: NotificationPanel ha 4s di delay iniziale per non colpire il cold start Render al primo paint.
