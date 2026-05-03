# Roadmap MaintAI

Ultimo aggiornamento: **2026-05-03**  
Versione Corrente: **3.2.0**

---

## v1.4 - Ergonomia & Scheduler Unificato (MAGGIO 2024) [COMPLETATO]
- [x] **Unificazione Scheduler e Piano**: Unica pagina operativa per la pianificazione.
- [x] **Layout Excel-like**: Gantt superiore per occupazione tecnici, lista ticket inferiore.
- [x] **Paginazione Server-side**: Gestione di grandi volumi di ticket (10 per pagina).
- [x] **Automatic Ticket Splitting**: Ticket > 8 ore vengono divisi automaticamente in "Parti" (Parte 1/2, 2/2).
- [x] **Manual Planning Lock**: Possibilità di bloccare manualmente un ticket in una data/ora; il ricalcolo AI lo ignora.
- [x] **Asset Status Workflow**: Modale di chiusura ticket che obbliga l'operatore a dichiarare lo stato asset (In Servizio/Fermo).
- [x] **Diagnostica AI Conclusiva**: La Root Cause identificata dall'AI genera automaticamente un ticket correttivo (CM) figlio.
- [x] **Quick Filters**: Filtri rapidi per Tipo (PM, CM, BD, ISP), Stato e Priorità.

## v1.5 - Enterprise Ready & Multi-tenant (GIUGNO 2024) [COMPLETATO]
- [x] **Multi-tenancy reale**: Isolamento dati via `tenant_id` e routing JWT dinamico per gestire più aziende.
- [x] **Global Search**: Barra di ricerca multi-campo per ID, Titolo, Asset o Tecnico in tutta la piattaforma.
- [x] **Badge Notifiche**: Contatore dinamico in tempo reale sull'icona della campanellina.
- [x] **Export Excel/CSV**: Download dei ticket filtrati per analisi esterne.
- [x] **Pagina Profilo**: Gestione utente, cambio password e personalizzazione preferenze.

## v2.0 - Automation & Smart Maintenance (LUGLIO 2024) [COMPLETATO]
- [x] **Bulk Import**: Caricamento massivo Siti, Impianti e Asset tramite template Excel (solo Superadmin).
- [x] **Condition-based Maintenance**: Trigger manutenzione basati su Running Hours (ore moto) oltre al calendario.
- [x] **Generazione Automatica**: Servizio di background che crea ticket dai task del piano allo scadere della soglia (ore o data).
- [x] **Adaptive Duration Estimator**: Correzione automatica dei tempi stimati basata sullo storico reale degli interventi.
- [x] **Opportunistic Maintenance**: Algoritmo che suggerisce PM "vicini" per riempire slot liberi del tecnico durante un intervento.
- [x] **System Log DB**: Persistenza dei log di sistema (AI, Email Poller, Errori) consultabili da interfaccia Admin.
- [x] **Data Retention Service**: Pulizia automatica programmata di ticket eliminati e file obsoleti.

## v3.0 - Collaborazione & Mobile Advanced (IN CORSO)
- [ ] **Thread di Commenti**: Chat interna e cronologia note per singolo ticket tra tecnici e responsabili.
- [ ] **Notifiche Push Web**: Notifiche browser e mobile (PWA) per assegnazione nuovi ticket.
- [ ] **QR Code Scanning Reale**: Scansione fisica del codice asset per apertura istantanea scheda o creazione ticket.
- [ ] **Report AI PDF**: Generazione automatica di un report PDF professionale a fine intervento sintetizzato dall'AI.
- [ ] **Firma Digitale Avanzata**: Acquisizione firma cliente/responsabile su touch-screen (già presente, da ottimizzare).
- [ ] **WebHooks & Integrazioni ERP**: API esterne per sincronizzazione con SAP, Oracle o Microsoft Dynamics.

## v3.5 - Predictive & Advanced AI (FUTURO)
- [ ] **Extraction Pezzi di Ricambio via NLP**: Estrazione automatica lista parti dai manuali caricati.
- [ ] **Predictive Maintenance (MTBF)**: Analisi trend guasti per prevedere rotture prima che accadano.
- [ ] **Voice-To-Ticket**: Creazione ticket tramite dettatura vocale naturale (Whisper).
- [ ] **Vision AI**: Analisi foto guasti tramite fotocamera per suggerire cause o pezzi di ricambio necessari.
- [ ] **Geolocalizzazione GPS**: Visualizzazione tecnici e asset su mappa per dispatching geografico.
- [ ] **Containerizzazione Docker**: Distribuzione completa in microservizi per deploy on-premise air-gapped.
- [ ] **SSO Integration**: Integrazione con Azure AD / Google Workspace.

---

*MaintAI — The Future of Industrial Maintenance.*
