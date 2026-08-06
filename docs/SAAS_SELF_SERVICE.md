# MaintAI SaaS self-service — studio di implementazione e prima fetta funzionante

**Data:** 6 agosto 2026
**Stato:** Fase 1 (fondazione commerciale) + Fase 3 parziale (registrazione) **implementate e provabili**.
Fase 2 (Stripe) implementata come adattatore, non attivata. Fase 4 (onboarding wizard) **non** implementata: solo modello dati e analisi.

Documento di riferimento: `MAINTAI_PIANO_SAAS_SELF_SERVICE.md` v1.0.

---

## 1. Valutazione del piano

### Cosa il piano coglie bene

**La diagnosi è giusta, ed è la parte difficile.** L'osservazione centrale — *«la priorità non è aggiungere altre funzioni manutentive, è costruire il livello che rende vendibili quelle già esistenti»* — è corretta e non banale. MaintAI ha più funzionalità manutentive di molti CMMS commerciali e zero infrastruttura per venderle. Continuare ad aggiungere moduli aumenta la distanza fra ciò che il prodotto sa fare e ciò che si riesce a incassare.

**La regola di separazione (§4.2) è la decisione architetturale corretta.** «Il frontend mostra lo stato e guida l'utente, ma non decide autorizzazioni o limiti» è esattamente la disciplina che evita la classe di bug più costosa in un SaaS: il limite aggirabile aprendo gli strumenti per sviluppatori.

**Stripe Checkout ospitato + webhook idempotenti** è la scelta giusta e ben motivata. Non si costruisce un sistema di pagamenti: si integra quello di qualcun altro e si difende il proprio lato con l'idempotenza.

### Dove il piano va corretto

Cinque punti, in ordine di impatto.

#### 1.1 Le tabelle `plans` e `plan_features` sono un errore di progettazione

Il piano (§5.4-5.5) mette il catalogo commerciale in database. Le conseguenze:

- serve una UI di amministrazione dei piani, che verrà usata due volte l'anno;
- il listino diverge fra staging e produzione, e la divergenza si scopre da un cliente;
- un piano non passa dalla code review, non sta in un diff, non è testabile.

Un piano **non è un dato del cliente**: è una decisione di prodotto, come le `MODULE_DEFINITIONS` che già stanno nel codice e per gli stessi motivi. I *prezzi* veri stanno comunque in Stripe.

→ **Implementato:** catalogo in `backend/core/plans.py`. Il DB conserva solo `subscriptions` (piano del cliente, add-on acquistati, periodo pagato).

#### 1.2 `usage_counters` per utenti/siti/asset introduce una seconda verità

Il piano (§5.6) prevede contatori per tutte le metriche. Ma utenti, siti e asset sono **metriche di stato**: sono già una `COUNT` sulla tabella. Un contatore per un dato derivabile è una copia da riconciliare, e prima o poi dirà «3 utenti» quando in tabella ce ne sono 2 — con l'utente bloccato e nessun modo di spiegargli perché.

→ **Implementato:** distinzione **stock** (misurate con COUNT, mai memorizzate) vs **flow** (chiamate AI: non ricostruibili, contatore necessario). `usage_counters` esiste ma serve solo alle metriche di flusso.

#### 1.3 Manca la decisione più importante del documento: feature flag *vs* moduli

Il piano introduce `plan_features` come sistema di gating **senza notare che MaintAI ne ha già uno**: `MODULE_DEFINITIONS` + `global_module_config` + `tenant_module_config`, con kill-switch globale e pagina Funzionalità.

Due meccanismi indipendenti che gatano lo stesso modulo producono, con certezza, il caso: *cliente paga la Diagnostica AI, non la vede, e nessuna delle due pagine di amministrazione sa dire perché*.

→ **Implementato:** il piano è un **terzo livello di risoluzione**, non un sistema parallelo. Precedenza:

```
moduli effettivi = (globale ∩ piano) con sopra le decisioni del tenant, intersecate col tetto
                    ─────  ────       ─────────────────────────────
                    kill    tetto     configurazione del cliente
                    switch  commerciale
```

La pagina Funzionalità riceve `blocked_by_plan` accanto a `blocked_by_global`: l'interruttore non promette più ciò che non può mantenere.

#### 1.4 Il rischio di prodotto è l'onboarding, non il billing — ma la sequenza è comunque corretta

Il billing è un problema risolto: Stripe più due giorni di lavoro. Il wizard in 8 passi con import, validazione, simulazione e rollback (§8) è la parte costosa e su misura, ed è dove morirà il KPI *«70% di onboarding completati senza supporto»*. Il piano lo colloca in Fase 4.

Ha comunque senso partire dal billing, **ma per una ragione diversa da quella scritta**: l'entitlement è un vincolo trasversale che tocca ogni endpoint di creazione. Retrofittarlo dopo significa ripassare su tutto il codice. L'ordine giusto è: *scheletro* dell'entitlement subito, Stripe quando serve incassare, onboarding appena c'è il primo cliente vero.

Va detto senza girarci intorno: **il lavoro fatto qui non rende MaintAI vendibile da solo.** Rende automatico l'incasso e la gestione dell'account. Un cliente industriale con 400 asset da caricare continuerà a servire assistenza fino a che l'import guidato non esiste.

#### 1.5 Il modello di vendita self-service puro è irrealistico per questo mercato

250-590 €/mese per un CMMS industriale multi-sito, in Italia, non si vende con un checkout senza mai parlare con nessuno. Il ciclo d'acquisto reale include una demo, una discussione sui dati esistenti e spesso una gara interna.

Questo **non toglie valore al piano**, ma ne cambia l'obiettivo: il livello commerciale non serve a eliminare la vendita, serve a eliminare il **lavoro operativo del fondatore** — creare tenant a mano, rincorrere rinnovi, gestire upgrade via email, spegnere account manualmente. È già di per sé il ritorno più alto del documento.

Il modello realistico è: **trial self-service** (che qualifica e riduce il costo del primo contatto) + **conversione assistita** + **gestione dell'account autonoma** dopo la firma. Tutto ciò che è stato costruito serve esattamente a questo.

### Note minori

- §16 chiede di rimuovere `typescript: { ignoreBuildErrors: true }`: **già fatto**, in `next.config.ts` il valore è `false` con nota SEC-04. Il piano parte da uno stato del repo non aggiornato.
- Il piano non menziona il **routing DB demo** (`is_demo=True` → `demo.db`). È rilevante: un trial reale non deve finire sul database demo. Verificato: la registrazione pubblica non emette JWT demo, quindi il caso non si presenta — ma è un vincolo da non violare in futuro.
- I sub-processor (OpenAI su tutte le chiamate AI) vanno nel DPA. È anche un argomento di vendita: MaintAI pseudonimizza già i dati verso l'LLM (`Pseudonymizer`), cosa che pochi concorrenti fanno.
- Il piano non prevede un ruolo **owner** del tenant. Aggiunto `Utente.is_tenant_owner`: serve alla disdetta e alla cancellazione dati, che non possono essere alla portata di ogni `responsabile`.

---

## 2. Cosa è stato implementato

### 2.1 Backend

| File | Ruolo |
|---|---|
| `backend/core/plans.py` | Catalogo piani e add-on, definizione delle metriche a quota |
| `backend/services/billing/entitlement_service.py` | Risoluzione entitlement, misura consumo, gate quote e scrittura |
| `backend/services/billing/subscription_service.py` | Ciclo di vita: trial, attivazione, cambio piano, disdetta, rinnovo |
| `backend/services/billing/providers.py` | `LocalBillingProvider` (checkout simulato) e `StripeBillingProvider` |
| `backend/services/billing/webhook_service.py` | Elaborazione idempotente degli eventi |
| `backend/services/billing/access_guard.py` | Modalità sola lettura come dependency dei router |
| `backend/services/notifications/mailer.py` | Email transazionali (SMTP opzionale, log in sviluppo) |
| `backend/api/routes/billing.py` | 12 endpoint `/billing/*` |
| `backend/api/routes/public_signup.py` | Registrazione, verifica email, reset password |
| `alembic/versions/20260806001_*.py` | 5 tabelle nuove + colonne su `tenants` e `utenti` |

**Modello dati**

```
subscriptions        1:1 con tenant — piano, stato, periodo, add-on
subscription_events  UNIQUE(provider_event_id) → idempotenza dei webhook
usage_counters       solo metriche di flusso (chiamate AI/mese)
auth_tokens          verifica email e reset password (solo hash SHA-256)
onboarding_progress  predisposto per il wizard, non ancora usato
```

**Endpoint**

```
GET  /billing/plans              catalogo (pubblico)
GET  /billing/subscription       stato del tenant corrente
GET  /billing/usage              consumo vs limiti
POST /billing/checkout-session   apre il pagamento
POST /billing/simulate-checkout  conferma il pagamento simulato (solo provider locale)
POST /billing/customer-portal    portale del provider
POST /billing/change-plan        upgrade/downgrade
POST /billing/change-quantities  licenze aggiuntive
POST /billing/cancel             disdetta
POST /billing/reactivate         riattivazione
GET  /billing/company            dati di fatturazione
PUT  /billing/company
POST /billing/webhook            eventi dal provider

GET  /public/signup-status       la registrazione è aperta?
POST /public/signup              azienda + admin + trial, atomico
POST /public/verify-email
POST /public/resend-verification
POST /public/forgot-password
POST /public/reset-password
```

**Punti in cui le quote sono applicate**

- `POST /utenti` → metrica `users`
- `POST /siti` → metrica `sites`
- `POST /assets` → metrica `assets`
- `agents_service._log_usage` → metrica `ai_calls` (registrata dove il consumo avviene, nella stessa transazione)

Tutte **prima** della scrittura: un 402 non lascia mai una risorsa a metà.

### 2.2 Frontend

```
app/pricing/page.tsx            listino pubblico (dal backend, non duplicato)
app/register/page.tsx           registrazione in un passo
app/verify-email/page.tsx       conferma indirizzo
app/forgot-password/page.tsx    richiesta reset
app/reset-password/page.tsx     nuova password
app/billing/checkout/page.tsx   pagamento simulato (dichiarato tale)
app/settings/billing/page.tsx   area abbonamento: stato, consumo, piani, licenze, dati fiscali
app/components/PlanBanner.tsx   avviso in cima all'app, solo quando c'è da agire
app/lib/billing.ts              client tipizzato + `asBillingBlock()`
```

`app/lib/api.ts` ora solleva `ApiError` con `status` e `detail` strutturato: un 402 di quota porta con sé metrica, consumo e limite, così la UI può dire *«3 utenti su 3, passa a Professional»* invece di `[object Object]`.

### 2.3 Test

`backend/tests/test_billing_entitlements.py` (23) — quote, add-on, stati, moduli per piano, downgrade licenze
`backend/tests/test_billing_webhooks.py` (12) — idempotenza, ordine eventi, robustezza
`backend/tests/test_saas_api.py` (21) — percorso completo via HTTP: signup → verifica → checkout → quota → sola lettura → pagamento → sblocco

Suite completa: **388 test verdi**, nessuna regressione.

---

## 3. Come provarlo

### 3.1 Il modo più rapido: script dimostrativo (nessun server da avviare)

```bash
python scripts/demo_saas.py
```

Percorre l'intero ciclo — registrazione, verifica email, trial, quota superata, checkout simulato, upgrade, scadenza, sola lettura, riattivazione — stampando ogni chiamata HTTP e il suo esito, su un database temporaneo che viene poi cancellato.

### 3.2 Provarlo dall'interfaccia

**Backend**

```bash
# backend/.env — le due chiavi sono obbligatorie
JWT_SECRET=$(python -c "import secrets; print(secrets.token_hex(32))")
ENCRYPTION_KEY=$(python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
DATABASE_URL=sqlite:///./maintai.db
SELF_SERVICE_SIGNUP_ENABLED=true    # in locale è già il default
APP_PUBLIC_URL=http://localhost:3000

python -m uvicorn backend.main:app --reload
```

**Frontend**

```bash
cd frontend && npm run dev
```

**Percorso da seguire**

1. `http://localhost:3000/pricing` — listino, servito dal backend
2. *Inizia la prova gratuita* → `/register` — azienda + amministratore in un passo
3. Senza SMTP configurato l'email non parte: la pagina di conferma mostra il link di verifica (**solo fuori produzione**)
4. `/login` con l'email scelta → si entra in prova, con banner quando mancano ≤ 5 giorni
5. Menu → **Abbonamento** (`/settings/billing`): piano, consumo, licenze
6. Crea un **secondo sito**: il trial ne include uno → **402** con consumo, limite e via d'uscita
7. *Passa a Professional* → checkout simulato → conferma → piano attivo, sito creabile
8. Per vedere la **sola lettura**: in `/settings/billing` disdici con effetto immediato, oppure porta indietro `trial_ends_at` sul DB. Le letture continuano, le scritture rispondono 402, l'abbonamento resta raggiungibile.

### 3.3 Provare gli eventi di billing senza Stripe

```bash
export BILLING_WEBHOOK_SECRET=segreto-di-prova

# pagamento fallito → tolleranza, accesso ancora pieno con banner
curl -X POST localhost:8000/billing/webhook \
  -H "x-billing-secret: segreto-di-prova" -H "Content-Type: application/json" \
  -d '{"id":"evt_1","type":"invoice.payment_failed","metadata":{"tenant_id":"2"},"data":{}}'

# la stessa consegna, ritentata: viene scartata come duplicato
curl -X POST localhost:8000/billing/webhook \
  -H "x-billing-secret: segreto-di-prova" -H "Content-Type: application/json" \
  -d '{"id":"evt_1","type":"invoice.payment_failed","metadata":{"tenant_id":"2"},"data":{}}'
```

### 3.4 Test

```bash
pytest backend/tests/test_billing_entitlements.py \
       backend/tests/test_billing_webhooks.py \
       backend/tests/test_saas_api.py -v
```

---

## 4. Passare a Stripe

Nulla da riscrivere: si installa la libreria e si configurano le variabili.

```bash
pip install stripe
```

```env
BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_START_MONTHLY=price_...
STRIPE_PRICE_START_YEARLY=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_YEARLY=price_...
STRIPE_PRICE_EXTRA_USER_MONTHLY=price_...
STRIPE_PRICE_EXTRA_SITE_MONTHLY=price_...
BILLING_SUCCESS_URL=https://app.maintai.it/settings/billing?checkout=success
BILLING_CANCEL_URL=https://app.maintai.it/pricing?checkout=cancelled
```

Webhook Stripe → `https://<backend>/billing/webhook`, eventi:
`checkout.session.completed`, `customer.subscription.*`, `invoice.paid`,
`invoice.payment_failed`, `invoice.payment_action_required`, `customer.updated`.

Cambiando provider:

- `/billing/simulate-checkout` risponde 404 (il pagamento finto sparisce da solo);
- il cambio piano e le licenze passano dal Customer Portal — gli endpoint diretti rispondono 409, per non far divergere ciò che il cliente vede da ciò che gli viene addebitato;
- la verifica della firma diventa obbligatoria: `STRIPE_WEBHOOK_SECRET` mancante = webhook rifiutato.

**Da fare prima di incassare davvero:** creare i Price su Stripe e mapparli, configurare Stripe Tax per l'IVA, verificare l'endpoint webhook in modalità test, e provare almeno una volta pagamento fallito e recupero.

---

## 5. Variabili d'ambiente introdotte

| Variabile | Default | Effetto |
|---|---|---|
| `BILLING_PROVIDER` | `local` (o `stripe` se c'è la chiave) | Provider di pagamento |
| `BILLING_WEBHOOK_SECRET` | — | Abilita il webhook del provider locale. Assente = endpoint chiuso |
| `BILLING_GRACE_DAYS` | `7` | Tolleranza su pagamento fallito |
| `TRIAL_DAYS` | `14` | Durata della prova |
| `SELF_SERVICE_SIGNUP_ENABLED` | attivo in dev, **spento in cloud** | Registrazione pubblica |
| `APP_PUBLIC_URL` | `http://localhost:3000` | Base dei link nelle email e del checkout |
| `SMTP_URL` | — | Invio email. Assente: in dev il messaggio va nei log, in produzione è un errore |
| `EMAIL_FROM` | `MaintAI <no-reply@maintai.local>` | Mittente |
| `TERMS_VERSION` / `PRIVACY_VERSION` | `2026-08-01` | Versione dei documenti accettati, registrata col consenso |
| `ACCOUNT_RETENTION_DAYS` | `30` | Finestra di ripensamento (predisposto) |

**In produzione `SELF_SERVICE_SIGNUP_ENABLED` è spento di default.** Aprire la creazione di tenant a chiunque è una decisione commerciale, non l'effetto collaterale di un deploy.

---

## 6. Retrocompatibilità

Nessun cliente esistente cambia comportamento.

- Un tenant **senza riga in `subscriptions`** è *grandfathered*: nessun limite, nessun tetto sui moduli, nessuna sola lettura. Vale per tutti i tenant attuali.
- Il livello commerciale si attiva **sottoscrivendo**, non si subisce al primo deploy.
- Tutti i gate sono **fail-open**: se il livello commerciale non è leggibile (tabella non ancora migrata, DB lento), la richiesta passa. Il costo di un falso positivo — un cliente pagante bloccato — è molto più alto di quello di un falso negativo.
- La migrazione non aggiunge colonne NOT NULL senza default e non tocca dati esistenti.

---

## 7. Cosa manca (onesto)

Non implementato, in ordine di importanza per la vendibilità:

1. **Wizard di onboarding** (§8 del piano) — modello dati pronto (`onboarding_progress`), logica e UI da fare. È il pezzo più costoso e quello che decide se un cliente parte da solo.
2. **Import guidato con anteprima, validazione e rollback** — esiste `bulk_import`, ma senza anteprima né correzione riga per riga.
3. **Export completo e cancellazione account** (§15) — `deletion_requested_at` c'è, la procedura no.
4. **Fatture in-app** — con Stripe le fornisce il Customer Portal; senza, non esistono.
5. **Centro assistenza e ticket di supporto** (§14) — `support_requests` non è stata creata: senza una destinazione per i ticket sarebbe una tabella che si riempie e basta.
6. **MFA per gli amministratori** (§11.1).
7. **Audit log firmato** (§11.3) — `SystemLog` c'è e registra gli eventi commerciali, ma non è append-only né firmato.
8. **CI bloccante e test di restore** (§16, §12).

Il primo punto è quello che separa «vendibile con assistenza» da «vendibile da solo».
