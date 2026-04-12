# MaintAI — Direttive di Sviluppo (v2.6.1)

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

## 🚀 Regole Operative
- **P0 Priority**: In caso di incidente operativo, la priorità è la STABILIZZAZIONE delle funzioni core rispetto all'estetica.
- **Autonomia**: Procedere fino a completamento se richiesto, garantendo test di integrazione silenti.
- **Auto-Miglioramento**: Al termine di ogni ciclo, aggiornare i file di direttiva per riflettere le nuove best-practice scoperte.
