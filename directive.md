# MaintAI — Direttive di Sviluppo (v2.6.0)

Queste direttive devono essere lette e applicate rigorosamente ad ogni sessione di sviluppo.

## 🎨 Design & UI/UX
- **Estetica Premium**: Utilizzare un design "state of the art". Colori profondi (slate, indigo), gradienti sottili e micro-animazioni.
- **Gerarchia Visiva**: Evitare testi troppo piccoli. Standard base: `text-sm` (14px). Usare `text-[10px]` solo per metadati secondari o badge.
- **Layout 3-Panel**: Per i moduli principali (Piani, Asset), utilizzare la struttura Side-Header-Content per massimizzare la velocità operativa.
- **No Placeholder**: Non usare immagini o icone segnaposto. Generare asset reali.

## 💻 Codice & Architettura
- **Clean Code**: Mantenere funzioni piccole e riutilizzabili.
- **Type Safety**: Evitare `any` in TypeScript. Definire interfacce chiare per ogni risposta API.
- **Repository Pattern**: Tutta la logica di accesso al DB deve risiedere nei Repository. Utilizzare `joinedload` per ottimizzare le query.
- **Scalabilità**: Le query devono sempre supportare filtri (`query`, `sito_id`, `impianto_id`) e paginazione server-side.

## 🚀 Regole Operative
- **Multi-Tenancy**: Garantire sempre l'isolamento dei dati tramite `tenant_id`.
- **Integrità Frontend-Backend**: Una feature non è terminata se non è funzionante e testabile dall'interfaccia utente.
- **Auto-Miglioramento**: Al termine di ogni ciclo, aggiornare i file di direttiva per riflettere le nuove best-practice scoperte.
