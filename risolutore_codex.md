# Risolutore Codex - Audit sicurezza e vendibilita SaaS

Data audit: 2026-05-31  
Repository: `E:\PROGETTI\MAINTAI_MVP_DEMO`  
Modalita: audit statico/read-only sui sorgenti, configurazioni e dipendenze; successiva creazione di questo documento su richiesta.

---

## 1. Verdetto sintetico

MaintAI e una demo avanzata e funzionalmente molto ricca, ma **non e ancora vendibile come SaaS multi-tenant in produzione**.

La vendibilita SaaS e bloccata soprattutto da:

- autorizzazione RBAC incompleta sugli endpoint mutanti;
- dipendenze frontend/backend con vulnerabilita note;
- possibile presenza di segreti in file tracciati;
- upload e allegati non sufficientemente isolati;
- endpoint pubblici QR/checklist troppo permissivi;
- privacy AI non uniforme su manuali/failure engine;
- gestione sessione/cache/localStorage da irrobustire;
- hardening Tauri incompleto;
- garanzie multi-tenant non ancora abbastanza forti a livello schema/test.

Classificazione commerciale:

| Scenario | Esito |
|---|---|
| Demo commerciale con dati fittizi | Vendibile |
| Pilot controllato con ambiente dedicato per singolo cliente | Possibile dopo fix urgenti |
| SaaS multi-tenant con dati reali di piu clienti | Non vendibile oggi |

---

## 2. Metodo usato

Sono stati usati come guida i file security presenti nel progetto:

- `docs/security.md`
- `docs/security_audit_2026-05-26.md`

Sono stati inoltre eseguiti controlli read-only:

- analisi statica dei router FastAPI, servizi, modelli ORM e frontend;
- ricerca mirata di endpoint mutanti privi di controllo ruolo;
- verifica di gestione JWT, cookie, revoche token e rate limiting;
- verifica upload, storage file, endpoint pubblici e AI services;
- audit dipendenze con `npm audit --omit=dev`;
- audit dipendenze Python con `pip-audit`;
- secret scan mirato su file tracciati, senza riportare valori sensibili;
- tentativo audit Rust/Tauri con `cargo audit`, non completato per tool non installato.

Non sono stati eseguiti test distruttivi, migrazioni, exploit attivi o modifiche applicative.

---

## 3. Cosa risulta gia migliorato

Rispetto ai precedenti audit security, diversi punti critici risultano corretti o migliorati:

- `JWT_SECRET` e obbligatorio e fallisce all'avvio se assente o troppo debole.
- `ENCRYPTION_KEY` e obbligatorio e validato come chiave Fernet.
- Le password usano hashing bcrypt.
- Il login imposta cookie HttpOnly.
- I token revocati sono controllati tramite `RevokedToken`.
- Il logout aggiunge il token alla blacklist.
- Gli endpoint di reset DB pubblici non risultano piu presenti.
- Gli endpoint file log sono limitati a superadmin.
- L'email poller anonimizza mittente e corpo email prima di creare ticket.
- Alcuni endpoint manuali e planning hanno filtri tenant migliorati.
- Il planner AI e la diagnostica applicano anonimizzazione in diversi percorsi.

Questi elementi indicano che il progetto ha gia una base security consapevole. Il problema e che mancano ancora controlli sistematici e garanzie difensive tipiche di un SaaS vendibile.

---

## 4. Problemi e soluzioni

### P0-01 - RBAC insufficiente sugli endpoint mutanti

**Gravita:** Critica  
**Area:** Backend API, autorizzazione, multi-tenant  
**Stato:** Bloccante SaaS

#### Problema

Molti endpoint richiedono autenticazione e tenant, ma non verificano il ruolo operativo dell'utente.

Il backend dispone di:

- autenticazione JWT;
- recupero tenant tramite `get_current_tenant_id`;
- dependency `require_superadmin`.

Non risulta pero una dependency centrale tipo `require_roles("responsabile", "planner", "superadmin")` applicata sistematicamente alle route mutanti.

Esempi di superfici interessate:

- creazione/modifica/eliminazione asset;
- creazione/modifica/eliminazione siti e impianti;
- gestione tecnici e assenze;
- generazione, conferma, deautorizzazione e modifica piani;
- configurazione email IMAP;
- import massivi;
- upload documenti asset/manuali.

Il frontend nasconde alcune voci di menu in base al ruolo, ma questo non e un controllo di sicurezza: un utente puo chiamare direttamente le API.

#### Impatto

Un tecnico autenticato potrebbe potenzialmente:

- modificare asset o anagrafiche;
- creare o cancellare tecnici;
- alterare piani AI;
- cambiare configurazioni email;
- manipolare dati di manutenzione.

In un SaaS industriale questo e un blocker assoluto.

#### Soluzione

Implementare autorizzazione server-side centralizzata.

Azioni consigliate:

1. Creare dependency:

```python
def require_roles(*allowed_roles: str):
    ...
```

2. Applicarla a tutte le route mutanti.

Esempio:

```python
@router.post("/")
def create_asset(
    ...,
    _: dict = Depends(require_roles("responsabile", "planner", "superadmin")),
):
    ...
```

3. Definire matrice permessi.

| Ruolo | Permessi consigliati |
|---|---|
| superadmin | gestione tenant, impersonificazione, audit globale |
| responsabile | gestione completa del tenant |
| planner | planning, ticket, tecnici, piani manutenzione |
| tecnico | lettura limitata, aggiornamento ticket assegnati, diagnostica |

4. Aggiungere test endpoint-level:

- tecnico non puo creare asset;
- tecnico non puo confermare piano;
- tecnico non puo configurare email;
- planner puo generare piano;
- responsabile puo deautorizzare piano;
- superadmin puo operare solo con contesto tenant esplicito quando necessario.

#### Criterio di chiusura

Tutti gli endpoint mutanti devono avere un controllo ruolo esplicito e test automatici.

---

### P0-02 - Dipendenze vulnerabili

**Gravita:** Critica  
**Area:** Supply chain  
**Stato:** Bloccante SaaS

#### Problema

Gli audit dipendenze hanno rilevato vulnerabilita note.

Frontend:

- `npm audit --omit=dev` segnala 10 vulnerabilita production;
- 3 risultano high;
- Next.js richiede upgrade alla linea corretta;
- advisory includono DoS, SSRF via websocket upgrade, middleware/proxy bypass, cache poisoning/request smuggling/XSS.

Backend:

- `python-multipart==0.0.22` vulnerabile;
- `cryptography==46.0.6` vulnerabile;
- `pytest==9.0.2` vulnerabile, e comunque non dovrebbe essere runtime production.

Rust/Tauri:

- `cargo audit` non e disponibile nell'ambiente, quindi audit incompleto.

#### Impatto

Rischio attivo su:

- parsing upload multipart;
- framework web frontend;
- proxy/middleware Next;
- librerie crittografiche;
- applicazione desktop Tauri non verificata.

#### Soluzione

Aggiornare e bloccare versioni sicure.

Azioni consigliate:

```bash
cd frontend
npm audit fix
npm run build
npm run lint
```

Poi verificare manualmente eventuali major upgrade.

Backend:

```bash
pip install --upgrade python-multipart cryptography pytest
pip-audit -r backend/requirements.txt
```

Versioni minime consigliate dal report:

- `python-multipart >= 0.0.27`
- `cryptography >= 46.0.7`
- `pytest >= 9.0.3`

Tauri:

```bash
cargo install cargo-audit
cd frontend/src-tauri
cargo audit
```

#### Criterio di chiusura

CI deve fallire se:

- `npm audit --omit=dev` ha high/critical;
- `pip-audit` ha vulnerabilita non accettate formalmente;
- `cargo audit` segnala vulnerabilita high/critical.

---

### P0-03 - Possibili segreti in file tracciati

**Gravita:** Critica se i valori sono reali  
**Area:** Secrets management  
**Stato:** Bloccante fino a verifica/rotazione

#### Problema

Il file `.claude/settings.local.json` risulta tracciato dal repository e contiene pattern compatibili con segreti o connessioni:

- `DATABASE_URL`
- `postgresql://`
- `JWT_SECRET`
- `ENCRYPTION_KEY`
- `TAURI_KEY_PASSWORD`

Non vengono riportati valori in questo documento.

#### Impatto

Se quei valori sono reali, devono essere considerati compromessi.

Possibili conseguenze:

- accesso al database;
- firma o falsificazione JWT;
- decrittazione credenziali salvate;
- compromissione firma/update Tauri;
- escalation su ambienti cloud.

#### Soluzione

Azioni immediate:

1. Verificare se i valori sono reali.
2. Ruotare tutti i segreti potenzialmente esposti:
   - password database;
   - `JWT_SECRET`;
   - `ENCRYPTION_KEY`;
   - OpenAI key se presente;
   - Tauri signing password/key se presente.
3. Rimuovere file sensibili dal tracking:

```bash
git rm --cached .claude/settings.local.json
```

4. Aggiungere ignore:

```gitignore
.claude/settings.local.json
.claude/worktrees/
.codex/local*
*.local.json
```

5. Se il repository e stato pushato, pulire la history con `git filter-repo` o procedura equivalente.

#### Criterio di chiusura

Nessun file tracciato deve contenere segreti reali o URL con credenziali. La secret scanning CI deve essere obbligatoria.

---

### P1-04 - Upload e allegati non sufficientemente protetti

**Gravita:** Alta  
**Area:** File storage, privacy, DoS  
**Stato:** Bloccante per SaaS con dati reali

#### Problema

Gli upload sono gestiti con controlli insufficienti per un SaaS:

- storage locale esposto via `/uploads`;
- in modalita cloud ritorno di URL pubblici;
- validazione spesso basata su estensione;
- file letti interamente in memoria prima del controllo dimensione;
- documenti asset serviti inline;
- tipi file molto ampi, inclusi zip/video/documenti office.

#### Impatto

Rischi:

- esposizione pubblica di allegati riservati;
- caricamento file malevoli;
- DoS memoria;
- data leak cross-tenant se URL sono condivisibili;
- problemi compliance su manuali tecnici, foto impianto, firme, allegati ticket.

#### Soluzione

Implementare storage privato e download autenticato.

Azioni:

1. Usare bucket privati.
2. Salvare solo chiave oggetto, non URL pubblico permanente.
3. Creare endpoint download autenticato:

```http
GET /tickets/{ticket_id}/allegati/{id}/download
```

4. Verificare sempre:

- tenant;
- permesso ruolo;
- ownership risorsa;
- MIME reale;
- magic byte;
- dimensione prima o durante stream;
- estensione coerente.

5. Servire documenti come attachment:

```http
Content-Disposition: attachment
X-Content-Type-Options: nosniff
```

6. Valutare antivirus/clamav o servizio managed.
7. Ridurre tipi ammessi al minimo necessario.

#### Criterio di chiusura

Nessun allegato deve essere accessibile senza autenticazione e autorizzazione tenant/ruolo.

---

### P1-05 - Endpoint QR pubblico troppo permissivo

**Gravita:** Alta  
**Area:** Public API, abuse prevention  
**Stato:** Bloccante per esposizione pubblica

#### Problema

Gli endpoint checklist QR pubblici consentono accesso senza autenticazione e creazione ticket. Non risultano sufficienti:

- scadenza token;
- revoca token;
- rate limit IP/token;
- lunghezze massime robuste;
- anti-spam;
- riduzione dei dati restituiti.

Inoltre la risposta pubblica contiene campi sensibili come `tenant_id` e `public_token`.

#### Impatto

Un token QR esposto puo essere abusato per:

- creare ticket spam;
- generare carico AI/operativo;
- ottenere informazioni su tenant;
- compromettere la qualita del backlog.

#### Soluzione

1. Token QR con:
   - scadenza;
   - stato `active/revoked`;
   - rotazione;
   - scope asset/checklist.
2. Rate limit:
   - per IP;
   - per token;
   - per tenant.
3. Non restituire `tenant_id` o token nella risposta pubblica.
4. Validare lunghezze:

```python
operatore: str = Field(max_length=120)
descrizione: str = Field(max_length=1000)
```

5. Creare ticket in stato "da validare" o con flag origine pubblica.
6. Aggiungere CAPTCHA o challenge leggero se esposto su internet.

#### Criterio di chiusura

Un QR rubato o fotografato non deve consentire abuso indefinito.

---

### P1-06 - Privacy AI non uniforme

**Gravita:** Alta  
**Area:** AI governance, GDPR, segreti industriali  
**Stato:** Bloccante per clienti enterprise

#### Problema

Alcuni flussi AI risultano anonimizzati, ma non tutti.

Buono:

- planner AI anonimizza ticket e tecnici;
- diagnostica usa anonymizer in diversi punti;
- problem analysis usa anonymizer;
- email poller anonimizza.

Critico:

- parser manuali invia testo estratto dal PDF al modello;
- failure engine invia sintomi, descrizione guasto e dati asset;
- guide/chat puo inviare contesto pagina e messaggi utente;
- rate limit non uniforme sugli endpoint AI;
- retention/logging dei contenuti AI da verificare.

#### Impatto

Possibile invio a provider AI di:

- manuali tecnici proprietari;
- nomi asset e impianti;
- dati operativi industriali;
- sintomi guasti;
- informazioni personali o confidenziali.

#### Soluzione

1. Definire policy AI per tenant:
   - AI abilitata/disabilitata;
   - consenso esplicito;
   - modello/provider;
   - data retention;
   - DPA.
2. Applicare anonymizer/minimizer a manuali, failure engine e guide.
3. Separare dati necessari da dati descrittivi.
4. Inserire rate limit su tutti gli endpoint AI.
5. Aggiungere quote per tenant.
6. Loggare solo metadati, mai prompt completi o dati sensibili.
7. Valutare modalita "no external AI" per clienti enterprise.

#### Criterio di chiusura

Ogni chiamata AI deve avere classificazione dati, consenso tenant, rate limit, minimizzazione e test.

---

### P1-07 - Sessione, localStorage e service worker cache

**Gravita:** Alta  
**Area:** Auth frontend, session security  
**Stato:** Da correggere prima SaaS

#### Problema

Il backend imposta cookie HttpOnly, ma ritorna ancora `access_token` nel JSON per Tauri. Nel frontend esistono ancora percorsi che leggono `maintai_jwt` da `localStorage`. Il service worker puo cacheare risposte GET autenticate e il logout non pulisce esplicitamente `CacheStorage`.

#### Impatto

Rischi:

- token accessibile a JavaScript in alcuni scenari;
- dati tenant persistenti su device condiviso;
- accesso offline a dati dopo logout;
- maggiore impatto in caso XSS.

#### Soluzione

1. Web:
   - usare solo cookie HttpOnly;
   - eliminare fallback `localStorage` browser;
   - non restituire JWT nel JSON per web.
2. Tauri:
   - usare keychain/Stronghold;
   - non usare localStorage per token persistenti.
3. Service worker:
   - non cacheare endpoint autenticati sensibili;
   - oppure usare cache per utente/tenant con pulizia rigorosa;
   - pulire `CacheStorage` al logout.

Esempio logout:

```ts
await caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
```

#### Criterio di chiusura

Dopo logout, nessun dato tenant deve restare leggibile da cache browser/app.

---

### P1-08 - Hardening Tauri insufficiente

**Gravita:** Alta  
**Area:** Desktop security  
**Stato:** Bloccante per distribuzione desktop enterprise

#### Problema

Configurazione Tauri:

- CSP disabilitata;
- permission `shell:default` abilitata;
- plugin shell disponibile;
- versioni non allineate tra frontend/backend/Tauri/Cargo.

#### Impatto

Una vulnerabilita XSS nel frontend desktop avrebbe impatto piu alto, specialmente se combinata con permessi shell o token in localStorage.

#### Soluzione

1. Definire CSP restrittiva.
2. Rimuovere `shell:default` se non indispensabile.
3. Limitare ogni permission Tauri al minimo.
4. Usare secure storage nativo per token.
5. Allineare versioni app.
6. Aggiungere `cargo audit` e `cargo deny` in CI.

#### Criterio di chiusura

Desktop build deve passare audit Tauri/Rust e avere CSP/permissions minime.

---

### P1-09 - Tenant isolation non garantita a livello schema

**Gravita:** Alta  
**Area:** Multi-tenant data model  
**Stato:** Da correggere prima SaaS multi-tenant

#### Problema

Molti modelli hanno `tenant_id nullable=True`, mentre le linee guida del progetto indicano isolamento per tenant su ogni tabella.

Questo rende possibile nel tempo la creazione di record orfani o globali non intenzionali.

#### Impatto

Rischi:

- record senza tenant;
- query che includono dati non previsti;
- bug cross-tenant difficili da rilevare;
- impossibilita di garantire isolamento forte ai clienti.

#### Soluzione

1. Mappare tutte le tabelle tenant-scoped.
2. Migrare dati orfani assegnandoli o archiviandoli.
3. Rendere `tenant_id NOT NULL` dove applicabile.
4. Aggiungere FK e indici compositi:

```sql
(tenant_id, id)
(tenant_id, stato)
(tenant_id, created_at)
```

5. Aggiungere test cross-tenant endpoint-level, non solo repository/model.

#### Criterio di chiusura

Ogni record tenant-scoped deve avere tenant obbligatorio e ogni endpoint deve essere testato contro IDOR cross-tenant.

---

### P1-10 - Configurazione produzione non fail-fast

**Gravita:** Alta  
**Area:** Deploy hardening  
**Stato:** Da correggere prima produzione

#### Problema

Alcuni default sono adatti allo sviluppo ma rischiosi se arrivano in produzione:

- `COOKIE_SECURE` default false;
- CORS include localhost/LAN se non configurato;
- fallback DB locale/SQLite da evitare in produzione;
- Supabase/storage privato non obbligatorio;
- security headers frontend non evidenti;
- Next ignora errori TypeScript/ESLint in build.

#### Impatto

Una misconfigurazione deploy puo produrre ambiente venduto ma non sicuro.

#### Soluzione

1. Introdurre `APP_ENV=production`.
2. In produzione fallire se:
   - `COOKIE_SECURE != true`;
   - `CORS_ORIGINS` assente o contiene localhost;
   - `DATABASE_URL` e SQLite;
   - storage privato non configurato;
   - `JWT_SECRET`/`ENCRYPTION_KEY` deboli;
   - logging debug abilitato.
3. Aggiungere headers Next:
   - `Content-Security-Policy`;
   - `X-Content-Type-Options: nosniff`;
   - `Referrer-Policy`;
   - `Permissions-Policy`;
   - `Strict-Transport-Security`.
4. Rimuovere:

```ts
ignoreBuildErrors: true
ignoreDuringBuilds: true
```

#### Criterio di chiusura

Un deploy production insicuro deve fallire all'avvio o in CI.

---

### P2-11 - IMAP server configurabile e rischio SSRF/egress

**Gravita:** Media/Alta  
**Area:** Email integration  
**Stato:** Da correggere prima self-service SaaS

#### Problema

La configurazione email accetta server IMAP arbitrario e il backend prova a connettersi.

#### Impatto

Un utente con permesso email config potrebbe usare il backend per:

- scansionare IP interni;
- raggiungere servizi locali/cloud metadata;
- abusare egress.

#### Soluzione

1. Consentire solo porta 993 salvo eccezioni approvate.
2. Risolvere DNS e bloccare:
   - loopback;
   - private IP;
   - link-local;
   - metadata service cloud;
   - multicast/reserved.
3. Timeout espliciti.
4. Allowlist provider o verifica dominio tenant.
5. Audit log dedicato per test connessione.

#### Criterio di chiusura

L'utente non deve poter usare IMAP config come proxy di rete.

---

### P2-12 - Bulk import non atomico e limiti file deboli

**Gravita:** Media  
**Area:** Import dati, resilienza  
**Stato:** Da migliorare prima clienti reali

#### Problema

L'import massivo dichiara comportamento non atomico e non risultano limiti robusti su dimensione/file prima della lettura.

#### Impatto

Rischi:

- dati parziali;
- inconsistenze tra tabelle;
- DoS con file grandi;
- rollback manuali complessi.

#### Soluzione

1. Validare file size prima di processare.
2. Usare staging table.
3. Eseguire dry-run obbligatorio.
4. Applicare transazione per batch.
5. Generare report errori senza scrivere dati parziali non approvati.

#### Criterio di chiusura

Import fallito non deve lasciare dati parziali non tracciati.

---

### P2-13 - Logging, retention e dati sensibili

**Gravita:** Media  
**Area:** Privacy, observability  
**Stato:** Da formalizzare

#### Problema

Il sistema ha log persistenti in DB, ma serve una policy chiara su:

- dati personali;
- prompt AI;
- allegati;
- errori contenenti stack trace;
- retention per tenant;
- export/cancellazione dati.

#### Impatto

Rischio GDPR e rischio leak interno tramite pannelli admin/log.

#### Soluzione

1. Definire retention per log applicativi.
2. Redigere dati sensibili prima del log.
3. Non loggare prompt AI o contenuti manuali.
4. Audit log separato per azioni amministrative.
5. Export/cancellazione per tenant.

#### Criterio di chiusura

Ogni categoria di dato deve avere retention e visibilita definite.

---

## 5. Roadmap risolutiva

### Fase 0 - Emergenza, 1-3 giorni

Obiettivo: rimuovere i rischi immediatamente bloccanti.

- Verificare e ruotare eventuali segreti tracciati.
- Aggiornare dipendenze vulnerabili frontend/backend.
- Installare ed eseguire audit Rust/Tauri.
- Bloccare build se audit high/critical fallisce.
- Disabilitare o limitare endpoint pubblici QR se esposti.
- Verificare configurazione produzione: cookie secure, CORS, DB, storage.

### Fase 1 - Security core, 1-2 settimane

Obiettivo: rendere accettabile l'uso con dati reali in pilot controllato.

- Implementare RBAC backend centrale.
- Applicare ruoli a tutti gli endpoint mutanti.
- Aggiungere test endpoint-level per ruoli e cross-tenant.
- Rendere storage allegati privato.
- Creare download autenticato per allegati/manuali/documenti asset.
- Limitare upload con MIME/magic byte/size streaming.
- Pulire service worker cache al logout.
- Rimuovere localStorage token dal web.

### Fase 2 - SaaS hardening, 2-4 settimane

Obiettivo: preparare multi-tenant production.

- Migrare `tenant_id` a `NOT NULL` dove applicabile.
- Aggiungere indici multi-tenant.
- Aggiungere policy AI per tenant.
- Anonimizzare/minimizzare manuali, failure engine e guide.
- Rate limit e quote su tutti gli endpoint costosi/AI/pubblici.
- Hardening Tauri: CSP, permissions minime, keychain/Stronghold.
- Headers security su Next.
- Fail-fast production config.

### Fase 3 - Compliance e vendibilita, 1-2 settimane

Obiettivo: arrivare a SaaS vendibile.

- DPA/OpenAI e documentazione trattamento dati.
- Registro subprocessors.
- Policy backup/restore.
- Piano incident response.
- Audit log amministrativo.
- Runbook operativi.
- Pen test staging.
- Report finale di readiness.

---

## 6. Test consigliati prima della vendita

### Backend security tests

- Tecnico non puo creare asset.
- Tecnico non puo cancellare impianti.
- Tecnico non puo confermare/deautorizzare piano.
- Tecnico puo aggiornare solo ticket assegnati.
- Planner non puo gestire tenant.
- Superadmin senza `X-Tenant-Id` non puo mutare risorse tenant-scoped.
- Utente tenant A non puo leggere/modificare record tenant B.
- Token revocato non accede.
- Tenant disattivato non accede.

### Upload tests

- File con estensione falsa rifiutato.
- File oltre limite rifiutato senza saturare memoria.
- Allegato tenant A non accessibile da tenant B.
- Allegato non accessibile senza login.
- File inline non eseguito/renderizzato dal browser.

### Public endpoint tests

- Token QR scaduto rifiutato.
- Token QR revocato rifiutato.
- Rate limit per token funzionante.
- Rate limit per IP funzionante.
- Campi lunghi rifiutati.

### AI/privacy tests

- Prompt manuali non contiene PII o segreti non necessari.
- Failure engine minimizza dati asset.
- Endpoint AI rate-limited.
- Tenant con AI disabilitata non invia richieste esterne.

### Frontend/session tests

- Logout cancella cache dati.
- Nessun token web in localStorage.
- Service worker non serve dati tenant dopo logout.
- Security headers presenti in produzione.

### Supply chain tests

- `npm audit --omit=dev` senza high/critical.
- `pip-audit` senza high/critical.
- `cargo audit` senza high/critical.
- Build fallisce su TypeScript/ESLint error.

---

## 7. Definition of Done per vendibilita SaaS

MaintAI puo essere dichiarato vendibile come SaaS multi-tenant solo quando tutte queste condizioni sono vere:

- RBAC server-side completo e testato.
- Nessun segreto reale tracciato in repository o history.
- Dipendenze senza vulnerabilita high/critical non accettate formalmente.
- Allegati e manuali accessibili solo tramite autorizzazione.
- Upload validati per dimensione, MIME, magic byte e tenant.
- Endpoint pubblici QR con token scadibili/revocabili e rate limit.
- AI governata per tenant, con consenso, minimizzazione e quote.
- Token web solo in cookie HttpOnly.
- Cache browser/service worker pulita al logout.
- Tauri con CSP e permissions minime.
- `tenant_id` obbligatorio sulle entita tenant-scoped.
- Test automatici cross-tenant e RBAC in CI.
- Config produzione fail-fast su CORS/cookie/DB/storage/segreti.
- Security headers attivi.
- Backup, retention, audit log e incident response documentati.

---

## 8. Priorita operative consigliate

Ordine consigliato di esecuzione:

1. Ruotare segreti e pulire file tracciati.
2. Aggiornare dipendenze vulnerabili.
3. Implementare RBAC backend.
4. Rendere privato lo storage allegati.
5. Sistemare QR pubblici.
6. Rimuovere token web da localStorage e pulire cache logout.
7. Fail-fast produzione e security headers.
8. Hardening AI/privacy.
9. Hardening Tauri.
10. Migrazione tenant schema e test cross-tenant.

Questo ordine riduce rapidamente il rischio piu alto e porta il progetto da "demo/pilot controllato" a "candidato SaaS vendibile".

---

## 9. Conclusione

Il prodotto ha una copertura funzionale forte: ticket, asset, piani AI, diagnostica, manuali, KPI, tecnici, email-to-ticket e multi-tenant applicativo. La direzione e buona.

La parte da completare non e una singola patch, ma un ciclo di hardening: autorizzazione sistematica, supply chain pulita, storage privato, privacy AI, session security, configurazione production e test automatici.

Fino alla chiusura dei P0/P1, la dichiarazione corretta e:

> MaintAI e presentabile come demo e pilot controllato, ma non ancora vendibile come SaaS multi-tenant production-ready.

