# MaintAI — Roadmap di Implementazione PMI Italia
**Versione:** 1.1 · **Basata su:** "Problemi più discussi dai manutentori nelle PMI italiane" (corpus maggio 2023–maggio 2026)  
**Data redazione:** 2026-05-24  
**Principio guida:** *"Porta ordine operativo misurabile in quattro settimane, e solo dopo posizionati come piattaforma AI avanzata."*

---

## Perché questa roadmap

Il report analizza 102 menzioni codificate da fonti italiane verificabili (Manutenzione & AM, Reddit Italia, LinkedIn, Unioncamere/Excelsior, Osservatori Polimi). Il messaggio è netto:

> I manutentori delle PMI non chiedono più predizione — **chiedono meno caos**.

I quattro problemi dominanti per frequenza combinata sono:
1. **Storico interventi assente o disperso** (carta, Excel, memoria verbale)
2. **Manutenzione preventiva incompleta o assente** (si aspetta che si rompa)
3. **Ricambi critici non disponibili** (lead time lunghi, stock mal gestito)
4. **Carenza di manutentori** (recruiting difficile, perdita know-how)

MaintAI risolve già in parte #2 (Piano Felix) e #4 (gestione tecnici). I gap principali sono su **#1 e tutto il contorno operativo** (costo fermo, mobile, knowledge, compliance).

> **Nota strategica sui ricambi (#3):** La gestione ricambi è un dominio sufficientemente complesso (ABC, fornitori, ordini, lead time) da meritare un **prodotto separato**, sviluppato in parallelo e collegato a MaintAI via API. In questa roadmap si predispongono solo i **ganci di integrazione** (campi, endpoint, UI placeholder) senza costruire il modulo completo. Vedi sezione "Predisposizione Ricambi".

---

## Stato attuale di MaintAI v3.2.1

| Funzionalità | Stato | Problema PMI coperto |
|---|---|---|
| Gestione Asset/Siti/Impianti | ✅ Produzione | Censimento asset (parziale) |
| Ticket con 5 stati + export Excel | ✅ Produzione | Storico (parziale, desktop-centrico) |
| Piano AI Felix (Gantt/Kanban/Calendario) | ✅ Produzione | Pianificazione caotica |
| Sessione diagnostica RCA interattiva | ✅ Produzione | RCA debole (parziale) |
| Manuali PDF → piano manutenzione | ✅ Produzione | Documentazione tecnica (parziale) |
| Dashboard KPI (polling 30s) | ✅ Produzione | Manutenzione vista come costo (parziale) |
| Kanban drag-and-drop | ✅ Produzione | Pianificazione visiva |
| Email-to-Ticket IMAP | ✅ Produzione | Riduzione attrito segnalazione |
| Gestione tecnici + assenze | ✅ Produzione | Carenza manutentori (parziale) |
| Multi-tenant JWT | ✅ Produzione | Isolamento dati |
| **Gestione ricambi / magazzino** | 🔗 Prodotto separato (integrazione futura) | Ricambi critici mancanti |
| **Costo fermo macchina** | ❌ Mancante | Manutenzione vista come costo |
| **Mobile PWA offline-first** | ❌ Mancante | Storico disperso / attrito digitale |
| **Knowledge base di reparto** | ❌ Mancante | Perdita conoscenza tacita |
| **Formazione operatori di primo livello** | ❌ Mancante | Operatori non formati |
| **Compliance / scadenze corsi / LOTO** | ❌ Mancante | Onere normativo |
| **MTBF / MTTR reali** | ❌ Mancante | Censimento asset / KPI incompleti |
| **Costo evitato visibile** | ❌ Mancante | Budget manutenzione percepito come puro costo |
| **Rilevazione guasti ricorrenti (AI pattern)** | ❌ Mancante | RCA debole |

---

## Criteri di prioritizzazione

Ogni milestone è ordinata su tre assi:
- **Frequenza problema** nel corpus PMI (peso 40%)
- **Impatto operativo/finanziario** dichiarato dai manutentori (peso 40%)
- **Sforzo implementativo** dato lo stack attuale FastAPI + Next.js (peso 20%)

---

## Milestone 1 — "Ordine nei dati" ⬛ Priorità Critica
**Obiettivo:** Rendere MaintAI lo strumento di registrazione quotidiana che sostituisce carta ed Excel.  
**Problema PMI principale:** Storico interventi assente (7,8%) · Censimento asset KPI incompleti (2,9%)  
**Orizzonte suggerito:** Sprint 1–3

### 1.1 — Ticket rapido "da campo" (input in <30 secondi)
**Gap:** Il manutentore sul campo deve aprire un ticket senza passare per 5 form.  
**Soluzione:**
- Modal "Nuovo Ticket Rapido" accessibile da qualsiasi pagina (shortcut globale `N`)
- Campi obbligatori ridotti a 3: Asset, Descrizione breve, Tipo (BD/PM/CM)
- Foto allegabile direttamente dalla fotocamera (drag-drop o input `capture`)
- Auto-completamento asset dall'ultimo usato o da QR code scannerizzato
- Il ticket entra come `Aperto` in 2 tap

**File coinvolti:**
- `frontend/app/ticket/` → nuovo componente `QuickTicketModal.tsx`
- `backend/api/routes/tickets.py` → endpoint `POST /tickets/quick`

---

### 1.2 — Asset con criticità e KPI integrati
**Gap:** Gli asset esistono ma mancano di `criticità`, `MTBF`, `MTTR` e storico visualizzabile.  
**Soluzione:**
- Aggiungere campo `criticita` (A/B/C) al modello Asset con etichetta visiva rossa/arancio/verde
- Calcolare automaticamente **MTBF** (media giorni fra ticket BD sullo stesso asset) e **MTTR** (media durata ticket BD chiusi)
- Widget "Storico interventi" nella pagina asset: ultimi 12 mesi, tipo ticket per colore
- Alert automatico: se MTBF scende sotto la soglia definita → suggerisce revisione preventiva

**File coinvolti:**
- `backend/db/modelli.py` → campo `criticita` su Asset + migrazione Alembic
- `backend/api/routes/assets.py` → endpoint `GET /assets/{id}/kpi`
- `frontend/app/asset/[id]/` → sezione KPI con Recharts sparkline

---

### 1.3 — Storico interventi consultabile da mobile (PWA base)
**Gap:** I manutentori cercano il "foglio giallo" per sapere cosa è stato fatto su una macchina.  
**Soluzione:**
- Attivare il manifest PWA su Next.js (`manifest.json` + `service-worker`)
- Pagina `/storico/[asset_id]` ottimizzata per mobile: lista cronologica ticket chiusi, foto allegate, note di chiusura
- Ricerca full-text locale (fuori rete) su storico cacciato con last-sync
- QR code stampabile per ogni asset → apre direttamente `/storico/[asset_id]`

**File coinvolti:**
- `frontend/public/manifest.json` (nuovo)
- `frontend/app/storico/[asset_id]/page.tsx` (nuovo)
- `frontend/app/lib/api.ts` → cache offline con `IndexedDB` via `idb` library

---

### 1.4 — Dashboard KPI potenziata con MTBF/MTTR/OEE parziale
**Gap:** La dashboard esiste ma mostra KPI aggregati senza drill-down per asset.  
**Soluzione:**
- Aggiungere card "Top 5 asset critici" (per frequenza guasti ultimi 90gg)
- Card "Backlog per tipo" con trend settimanale
- Metrica **Disponibilità Tecnica** = 1 − (MTTR / (MTTR + MTBF)) per asset con ≥3 guasti
- Export CSV di tutti i KPI (richiesta diretta della community)

**File coinvolti:**
- `backend/api/routes/` → nuovo router `kpi.py`
- `frontend/app/dashboard/` → nuovi componenti Recharts

---

## Milestone 2 — "Costo Fermo + Predisposizione Ricambi" ⬛ Priorità Alta
**Obiettivo:** Rendere visibile il costo economico del fermo e predisporre i ganci per il futuro modulo ricambi dedicato.  
**Problema PMI principale:** Manutenzione vista come costo (7,8%) · Ricambi mancanti (8,8% — affrontato con predisposizione)  
**Orizzonte suggerito:** Sprint 4–6

> ℹ️ **Decisione architetturale:** La gestione ricambi completa (magazzino, ABC, ordini, fornitori) sarà un **prodotto separato** collegato a MaintAI. In questa milestone si implementano solo i **ganci di integrazione** lato MaintAI: campo ricambio nel ticket, placeholder visivo, API hook. Nessuna pagina `/ricambi` completa per ora.

---

### 2.1 — Costo Fermo Asset integrato nel Ticket ✅ Da implementare
**Gap:** Nessuno vede il costo del fermo → la manutenzione continua ad essere percepita come puro costo.  
**Soluzione:**
- Campo `costo_orario_fermo` sull'Asset (€/ora, inserito dal planner una volta sola)
- Calcolo automatico `costo_fermo_stimato` = `durata_stimata_ore × costo_orario_fermo`
- Badge arancio nel dettaglio ticket se costo stimato supera soglia configurabile
- Nel Piano Felix → colonna "Costo Fermo Evitato" nella tabella workorder pianificati
- Dashboard: card **"Costo fermo evitato questo mese"** (somma ticket PM/CM chiusi × costo orario asset)
- Questo numero è l'argomento più diretto per giustificare la manutenzione alla direzione

**File coinvolti:**
- `backend/db/modelli.py` → campo `costo_orario_fermo` su `Asset`
- `backend/db/modelli.py` → campo calcolato `costo_fermo_stimato` su `Ticket`
- `frontend/app/ticket/` → badge costo fermo nel modal dettaglio
- `frontend/app/planning/` → colonna costo evitato nel Gantt
- `frontend/app/dashboard/` → nuova card KPI economico

---

### 2.2 — Predisposizione Ricambi (ganci di integrazione) 🔗 Placeholder
**Strategia:** Preparare MaintAI a ricevere il modulo ricambi esterno senza costruirlo ora.  
**Cosa si implementa:**

**Lato modello dati (minimo necessario):**
- Campo `ricambio_note` (testo libero) su `Ticket` → il tecnico annota manualmente il ricambio usato
- Campo `in_attesa_ricambio` (booleano) su `Ticket` → flag visivo "🔴 Bloccato – attesa ricambio"
- Colonna `codice_ricambio_esterno` su `Asset` (stringa) → predisposta per futura foreign key verso il sistema ricambi

**Lato API (hook per integrazione futura):**
- Endpoint `GET /assets/{id}/ricambi-suggeriti` → restituisce `[]` ora, sarà popolato dal modulo esterno
- Endpoint `POST /tickets/{id}/ricambio-usato` → salva in `ricambio_note`, pronto per essere esteso
- Entrambi documentati in OpenAPI con tag `🔗 integrazione-futura`

**Lato UI (placeholder visibile):**
- Nel modal ticket → sezione collassata "Ricambi" con campo testo libero + flag "in attesa"
- Tooltip sul flag: *"Il modulo ricambi completo sarà disponibile prossimamente"*
- Nella pagina asset → riga "Ricambi correlati" con link disabilitato e badge `Coming soon`

**File coinvolti:**
- `backend/db/modelli.py` → 2 campi su `Ticket`, 1 su `Asset`
- `backend/api/routes/tickets.py` → endpoint `ricambio-usato`
- `backend/api/routes/assets.py` → endpoint `ricambi-suggeriti` (stub)
- `frontend/app/ticket/` → sezione ricambi collassata nel modal
- Migrazione Alembic (leggera, solo 3 colonne)

---

## Milestone 3 — "Mobile & Campo" ⬛ Priorità Alta
**Obiettivo:** Un tecnico sul campo deve poter usare MaintAI con un guanto e lo schermo sudicio.  
**Problema PMI principale:** Storico disperso (7,8%) · Adozione CMMS frenata da complessità (3,9%) · Team overload (3,9%)  
**Orizzonte suggerito:** Sprint 8–11

### 3.1 — Progressive Web App completa (offline-first)
**Gap:** La community chiede esplicitamente software semplici e mobili (trend dominante 2026).  
**Soluzione:**
- Service Worker con cache-first per le pagine `/ticket`, `/storico`, `/ricambi`
- Sincronizzazione offline: il tecnico chiude un ticket offline → si sincronizza appena torna in rete
- Icona installabile su home screen Android/iOS
- Toast di connettività: banner "Modalità offline — dati sincronizzati al ripristino rete"
- Layout ottimizzato per touch: bottoni ≥44px, font ≥16px, no hover-only actions

**File coinvolti:**
- `frontend/public/sw.js` (nuovo Service Worker)
- `frontend/app/lib/offline-queue.ts` (nuovo — coda operazioni offline)
- `frontend/app/globals.css` → mobile breakpoints specifici

---

### 3.2 — Input vocale per chiusura rapportino
**Gap:** Il tecnico torna sporco, deve registrare l'intervento. Non lo fa → storico assente.  
**Soluzione:**
- Pulsante 🎙️ nel modal chiusura ticket → Web Speech API (`SpeechRecognition`)
- Il testo dettato compila automaticamente il campo "Note di chiusura"
- AI (GPT-4.1-mini) struttura la nota vocale in: causa_guasto, azione_eseguita, ricambi_usati, tempo_speso
- Feedback visivo durante registrazione (waveform animata)
- Fallback testuale sempre disponibile

**File coinvolti:**
- `frontend/app/ticket/` → componente `VoiceInput.tsx`
- `backend/api/routes/tickets.py` → endpoint `POST /tickets/{id}/parse-note` (AI strutturazione)
- `backend/services/ticket_service.py` → logica parsing AI

---

### 3.3 — QR Code per asset (scan → storico in 1 secondo)
**Gap:** Il tecnico arriva alla macchina e non sa cosa è stato fatto. Il foglio giallo non c'è.  
**Soluzione:**
- Ogni asset genera un QR code univoco (stampabile come etichetta)
- Scansione QR → apre `/storico/[asset_id]` direttamente su mobile
- Da quella pagina: "Apri nuovo ticket" in 1 tap
- Generazione QR in batch per tutti gli asset del sito (PDF stampabile multi-pagina)
- Libreria: `qrcode` lato backend (Python) per generazione, `html5-qrcode` lato frontend per scan

**File coinvolti:**
- `backend/api/routes/assets.py` → `GET /assets/{id}/qrcode` + `GET /assets/batch-qr`
- `frontend/app/assets/` → pulsante "Stampa QR" + scanner integrato

---

### 3.4 — Notifiche push browser (alert ricambi, scadenze PM)
**Gap:** Il planner scopre i problemi troppo tardi.  
**Soluzione:**
- Web Push Notifications via `PushManager` API (VAPID keys)
- Tipi di notifica: ticket BD aperto su asset critico, ricambio sotto stock minimo, PM in scadenza oggi
- Gestione consenso in-app con spiegazione del valore
- Backend: endpoint `POST /notifications/subscribe` + worker di dispatch (può usare background task FastAPI)

**File coinvolti:**
- `backend/api/routes/notifications.py` (nuovo)
- `frontend/app/lib/push.ts` (nuovo)
- `frontend/app/layout.tsx` → richiesta permesso push

---

## Milestone 4 — "Knowledge & Formazione" ⬛ Priorità Media-Alta
**Obiettivo:** MaintAI diventa il repository vivo della conoscenza di reparto, riducendo dipendenza dai senior.  
**Problema PMI principale:** Turnover e perdita conoscenza tacita (4,9%) · Operatori non formati (6,9%) · RCA debole (4,9%) · Documentazione tecnica irreperibile (3,9%)  
**Orizzonte suggerito:** Sprint 12–16

### 4.1 — Knowledge Base per asset (procedure corte)
**Gap:** Quando il senior va in ferie, nessuno sa come fare.  
**Soluzione:**
- Sezione "Procedure" nell'asset: lista di procedure corte (titolo + passi numerati + foto)
- Tipi: `Ispezione` · `Sostituzione` · `Taratura` · `LOTO` · `Emergenza`
- Ogni procedura ha revisione numerata e data ultima modifica
- Il tecnico può accedere alla procedura durante un ticket aperto (link contestuale)
- I manuali PDF già caricati alimentano la KB automaticamente via AI (estrazione passi operativi)
- Ricerca full-text nella KB da mobile

**File coinvolti:**
- `backend/db/modelli.py` → modelli `Procedura`, `PassoProcedura`
- `backend/api/routes/procedure.py` (nuovo)
- `frontend/app/asset/[id]/procedure/` (nuovo)

---

### 4.2 — Errori tipici e guasti ricorrenti (AI pattern detection)
**Gap:** Lo stesso guasto si ripete ogni 3 mesi perché non esiste RCA strutturata.  
**Soluzione:**
- Dopo la chiusura di un ticket BD → AI propone "Causa probabile" da storico simile (stesso asset o stesso tipo)
- Rilevazione automatica: se lo stesso guasto si ripete ≥3 volte in 6 mesi → alert "Guasto ricorrente" con suggerimento PM
- Pagina `/rca/[ticket_id]` guidata: timeline guasto → 5 Why assistito da AI → azione correttiva → collegamento a nuova attività PM
- Export PDF del report RCA (per audit, direzione, cliente)

**File coinvolti:**
- `backend/services/ai_planner_service.py` → funzione `detect_recurring_faults()`
- `backend/api/routes/rca.py` (nuovo)
- `frontend/app/rca/` (nuovo)

---

### 4.3 — Microformazione operatori di primo livello
**Gap:** Gli operatori di produzione ignorano i segnali anomali → guasto evitabile non segnalato.  
**Soluzione:**
- Sezione "Check di primo livello" sull'asset (visibile anche senza login completo — link QR)
- Checklist visuale: lista segnali da monitorare + foto di riferimento "normale" vs "anomalo"
- Operatore clicca "Ho visto un'anomalia" → apre ticket rapido pre-compilato con categoria "Segnalazione operatore"
- Planner vede i ticket segnalati-da-operatore con badge distinto
- Statistiche: "segnalazioni operatore → guasti evitati" (metrica di impatto formazione)

**File coinvolti:**
- `backend/db/modelli.py` → modello `CheckPrimoLivello`
- Pagina pubblica (no auth) `/check/[asset_token]` per operatori
- `frontend/app/ticket/` → badge "Segnalazione operatore"

---

### 4.4 — Note senior e knowledge transfer
**Gap:** Chi sa come si aggiusta la macchina 7 è quello con 20 anni di esperienza.  
**Soluzione:**
- Campo "Nota tecnica senior" su ogni asset (Markdown, solo utenti con ruolo Tecnico/Planner)
- Storico revisioni della nota (chi ha scritto cosa e quando)
- Integrazione con la chiusura ticket: "Aggiungi questa nota alla KB dell'asset?" (1 click)
- Tag `#errore-tipico`, `#trucco`, `#attenzione`, `#fornitore` per ricerca mirata

**File coinvolti:**
- `backend/db/modelli.py` → campo `nota_senior` + `NotaAsset` (versioned)
- `frontend/app/asset/[id]/` → sezione nota senior con editor Markdown

---

## Milestone 5 — "Compliance & AI Avanzata" ⬛ Priorità Media
**Obiettivo:** Ridurre l'attrito normativo e introdurre AI predittiva dove crea valore tangibile.  
**Problema PMI principale:** Onere normativo (2,0%) · Sicurezza compressa (2,0%) · Inefficienze energetiche (2,9%) · Adozione AI/IoT frenata (3,9%)  
**Orizzonte suggerito:** Sprint 17–22

### 5.1 — Scadenzario compliance (corsi, attestati, qualifiche)
**Gap:** Nelle PMI impiantistiche l'onere regolatorio è complesso e oneroso.  
**Soluzione:**
- Modello `Attestato` sul Tecnico: tipo corso, data conseguimento, data scadenza, ente certificatore
- Alert automatico 60/30/7 giorni prima della scadenza (dashboard + push + email)
- Pagina `/compliance` con vista calendario scadenze per tutto il team
- Export PDF "Stato attestazioni" per audit esterni

**File coinvolti:**
- `backend/db/modelli.py` → modello `Attestato`
- `backend/api/routes/compliance.py` (nuovo)
- `frontend/app/compliance/` (nuovo)

---

### 5.2 — LOTO digitale e pre-job risk assessment
**Gap:** Le procedure di sicurezza vengono saltate sotto pressione produttiva.  
**Soluzione:**
- Checklist LOTO digitale collegata al ticket (obbligatoria per ticket su asset con `loto_required=True`)
- Pre-job risk assessment a 5 domande prima dell'inizio lavori → firma digitale del tecnico
- Audit trail: tutte le LOTO completate salvate con timestamp e firma
- Il piano Felix mostra warning se un tecnico è privo dell'attestato richiesto per l'asset da lavorare

**File coinvolti:**
- `backend/db/modelli.py` → modelli `LOTO`, `RiskAssessment`
- `frontend/app/ticket/` → step LOTO nel flusso chiusura ticket
- `backend/services/planner_engine.py` → vincolo attestato tecnico

---

### 5.3 — Dashboard economica "Costo evitato" per la direzione
**Gap:** La manutenzione è percepita come costo perché nessuno vede il costo evitato.  
**Soluzione:**
- Pagina `/report/economico` (solo ruolo Planner/Admin)
- Metriche principali: Costo fermo evitato (PM × costo_orario_fermo), Costo fermo subito (BD × durata × costo_orario), Ratio prevenzione/reazione
- Trend mensile 12 mesi con benchmark "prima/dopo MaintAI" (data di attivazione)
- PDF "Executive Summary Manutenzione" generabile on-demand per la direzione
- Questo documento vale come ROI del software → argomento di vendita e rinnovo

**File coinvolti:**
- `backend/api/routes/report.py` → endpoint `/report/economico`
- `frontend/app/report/economico/page.tsx` (nuovo)
- PDF generato con ReportLab lato backend

---

### 5.4 — Anomalie energetiche collegate ai ticket
**Gap:** Le perdite energetiche (aria compressa, perdite termiche) non vengono mai legate alla manutenzione.  
**Soluzione:**
- Campo `consumo_atteso_kwh` sull'asset (inserito dal planner)
- Sezione "Anomalie energetiche" nel ticket: tecnico può segnalare consumi anomali rilevati durante l'intervento
- Dashboard: card "Asset con anomalia energetica aperta" (con stima risparmio se risolta)
- Integrazione futura: lettura da contatori IoT via webhook (placeholder API predisposta)

**File coinvolti:**
- `backend/db/modelli.py` → campo `consumo_atteso_kwh` su Asset + modello `AnomaliaEnergetica`
- `frontend/app/asset/[id]/` → sezione anomalie energetiche

---

### 5.5 — AI predittiva leggera (pattern + suggerimenti)
**Gap:** L'AI deve giustificarsi in fretta su use case tangibili, non su promesse generiche.  
**Soluzione:**
- **Suggeritore causa probabile**: quando si apre un ticket BD, AI suggerisce top-3 cause da storico analogo (stesso asset o stesso tipo macchina nel tenant)
- **Auto-tagging ticket**: AI classifica automaticamente `tipo`, `priorita` e `asset` da descrizione libera
- **Generatore PM da storico**: ogni 30 giorni, AI propone nuove attività preventive basate sui guasti ricorrenti non coperti dal piano
- **Compilazione rapportino**: da note vocali/testuali grezze → struttura compilata automaticamente (causa, azione, ricambio, tempo)
- Tutte le funzioni AI sono **opt-in** e mostrano sempre il risultato con possibilità di modifica

**File coinvolti:**
- `backend/services/ai_planner_service.py` → nuove funzioni AI operative
- `backend/api/routes/tickets.py` → endpoint suggerimenti AI
- `frontend/app/ticket/` → widget "Suggerimento AI" (badge dismissibile)

---

## Tabella riepilogativa per priorità

| # | Feature | Milestone | Problema PMI | Frequenza | Impatto |
|---|---|---|---|---|---|
| 1 | Ticket rapido campo (<30s) | M1 | Storico assente | 7,8% | 🔴 Critico |
| 2 | Asset criticità + MTBF/MTTR | M1 | Censimento KPI | 2,9% | 🔴 Critico |
| 3 | PWA storico offline | M1 | Storico disperso | 7,8% | 🔴 Critico |
| 4 | Costo fermo asset nel ticket | M2 | Manutenzione = costo | 7,8% | 🔴 Critico |
| 5 | Predisposizione ricambi (ganci) | M2 | Ricambi mancanti | 8,8% | 🟡 Placeholder |
| 6 | Dashboard KPI MTBF/MTTR/backlog | M1 | KPI incompleti | 2,9% | 🟠 Alto |
| 7 | PWA offline completa | M3 | Adozione frenata | 3,9% | 🟠 Alto |
| 8 | Input vocale rapportino | M3 | Storico assente | 7,8% | 🟠 Alto |
| 9 | QR code asset | M3 | Storico disperso | 7,8% | 🟠 Alto |
| 10 | Hook API ticket→ricambi (stub) | M2 | Ricambi mancanti | 8,8% | 🔗 Predisposizione |
| 11 | Knowledge base procedure | M4 | Perdita know-how | 4,9% | 🟠 Alto |
| 12 | RCA guidata + guasti ricorrenti | M4 | RCA debole | 4,9% | 🟠 Alto |
| 13 | Checklist primo livello operatori | M4 | Operatori non formati | 6,9% | 🟠 Alto |
| 14 | Note senior versioned | M4 | Perdita know-how | 4,9% | 🟡 Medio |
| 15 | Notifiche push browser | M3 | Pianificazione caotica | 5,9% | 🟡 Medio |
| 16 | Scadenzario compliance | M5 | Onere normativo | 2,0% | 🟡 Medio |
| 17 | LOTO digitale + risk assessment | M5 | Sicurezza compressa | 2,0% | 🟡 Medio |
| 18 | Dashboard economica costo evitato | M5 | Manutenzione = costo | 7,8% | 🟡 Medio |
| 19 | Anomalie energetiche | M5 | Inefficienze energetiche | 2,9% | 🟢 Basso |
| 20 | AI predittiva leggera | M5 | Adozione AI frenata | 3,9% | 🟢 Basso |

---

## Cosa NON fare (trappole da evitare)

Basandosi direttamente sul corpus PMI:

| Tentazione | Perché evitarla ora |
|---|---|
| **IoT / condition monitoring avanzato** | Solo il 59% delle medie imprese ha un progetto IoT. Per le piccole è accessorio, non base. Predisporre l'API, non costruire il modulo. |
| **Predittiva ML complessa** | Solo l'8% delle PMI ha avviato progetti AI nel 2025. Va bene se risolve problemi tangibili in <1 settimana di uso. |
| **Moduli HR/recruiting** | La carenza di manutentori è un problema di mercato del lavoro, non di software. MaintAI può solo mitigare (knowledge retention, onboarding rapido). |
| **Dashboard troppo sofisticate** | La community vuole "storico ritrovabile in secondi" e "meno Excel". Non vuole 15 KPI da spiegare al management. |
| **Workflow rigidi multi-approvazione** | Le PMI non hanno struttura per 4 livelli di approvazione. Il flusso deve reggere anche con 2 persone. |
| **Modulo ricambi completo in MaintAI** | Dominio troppo ricco (ABC, fornitori, ordini, lead time) per essere un sotto-modulo. Sarà un prodotto separato integrato via API. Predisporre i ganci ora, costruire dopo. |

---

## Architettura target post-roadmap

```
MaintAI v4.x (target)
├── 📱 PWA Mobile (offline-first, QR scan, voice input)
│   └── Tecnico: chiude ticket, consulta KB, LOTO, checklist
│
├── 🖥️  Dashboard Planner (attuale + potenziata)
│   ├── Piano Felix (Gantt/Kanban/Calendario)
│   ├── KPI: MTBF, MTTR, Disponibilità Tecnica, Costo Fermo
│   └── Dashboard Economica (costo evitato vs subito)
│
├── 🔧 Core Operativo
│   ├── Asset → Criticità + MTBF/MTTR + QR + KB
│   ├── Ticket → Rapido + Costo Fermo + AI causa + note ricambio (testo libero)
│   ├── Piano Felix → (vincoli attestati)
│   └── 🔗 Hook ricambi → pronto per integrazione modulo esterno
│
├── 🏭 Modulo Ricambi [Prodotto separato — integrazione futura]
│   ├── Stock minimo + ABC + Alert
│   ├── Movimenti (uso/acquisto/reso)
│   └── API bridge → MaintAI ticket/asset
│
├── 📚 Knowledge Layer
│   ├── Procedure (tipi: ispezione, sostituzione, LOTO, emergenza)
│   ├── Note senior versioned
│   ├── Check primo livello operatori (no-auth QR)
│   └── RCA guidata (5 Why AI-assisted)
│
├── 🛡️ Compliance
│   ├── Attestati + scadenzario
│   ├── LOTO digitale + audit trail
│   └── Pre-job risk assessment
│
└── 🤖 AI Operativa (pragmatica, opt-in)
    ├── Suggeritore causa da storico
    ├── Auto-tagging ticket
    ├── Generatore PM da guasti ricorrenti
    └── Strutturazione rapportino da voce
```

---

## Indicatori di successo per ogni milestone

### M1 completata se:
- [ ] Un tecnico registra un intervento in <30 secondi da mobile
- [ ] Ogni asset mostra MTBF e MTTR calcolati automaticamente
- [ ] La pagina storico asset è accessibile via QR senza aprire la dashboard

### M2 completata se:
- [ ] Ogni ticket mostra il costo fermo stimato (€)
- [ ] La dashboard mostra "costo fermo evitato questo mese"
- [ ] I ganci API ricambi sono presenti e documentati in OpenAPI
- [ ] Il flag "in attesa ricambio" è funzionante sul ticket

### M3 completata se:
- [ ] MaintAI funziona offline per 8 ore e si risincronizza automaticamente
- [ ] Il tecnico può chiudere un ticket dettando le note a voce
- [ ] Notifiche push arrivano entro 5 minuti dall'evento

### M4 completata se:
- [ ] Ogni asset ha almeno una procedura operativa allegata
- [ ] I guasti ricorrenti vengono rilevati automaticamente e propongono PM
- [ ] Un operatore di linea può segnalare un'anomalia senza login

### M5 completata se:
- [ ] Il report economico "costo evitato" è presentabile alla direzione in PDF
- [ ] Tutte le scadenze corsi del team sono visibili in un calendario
- [ ] L'AI suggerisce la causa del guasto con ≥60% di accuratezza percepita dai tecnici

---

## Note implementative per lo stack attuale

### Backend (FastAPI + SQLAlchemy)
- Ogni nuovo modulo segue la struttura: `modelli.py` → migrazione Alembic → `routes/` → `services/`
- I log persistenti sempre via `log_to_db()` / `db_info()` / `db_error()`
- Le funzioni AI usano `gpt-4.1-mini` (veloce, economico) per suggerimenti real-time; `gpt-4.1` solo per RCA approfondite
- I nuovi modelli su SQLite (demo) usano `batch_alter_table`; il fallback `_ensure_columns()` in `main.py` copre i deploy su Render

### Frontend (Next.js 15 + Tailwind v4)
- La PWA non richiede framework aggiuntivi: `next-pwa` o Service Worker manuale
- Voice input: Web Speech API nativa (Chrome/Edge/Android), fallback su textarea
- QR scan: `html5-qrcode` (lightweight, no native app required)
- I nuovi componenti mobile seguono il design system esistente: dark industrial, font ≥16px su mobile

### Demo DB
- Tutti i nuovi moduli devono avere seed data realistici nel `demo.db` (2 procedure, 3 attestati scaduti, 3 asset con costo_orario_fermo compilato, 2 ticket con flag `in_attesa_ricambio`)
- Il tour demo deve toccare i 4 problemi principali in <5 minuti
- I ganci ricambi nel demo mostrano dati mock statici (array hardcoded) finché il modulo esterno non è pronto

---

*Roadmap redatta sulla base del report "Problemi più discussi dai manutentori nelle PMI italiane" (corpus maggio 2023–maggio 2026, 102 menzioni codificate). Priorità verificate contro lo stack MaintAI v3.2.1.*
