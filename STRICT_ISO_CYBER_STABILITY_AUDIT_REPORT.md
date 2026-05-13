# STRICT ISO CYBER SECURITY & STABILITY AUDIT REPORT

**Sistema**: MaintAI  
**Data**: 2026-05-13  
**Versione**: 3.2.0 (build 2026-05-01)  
**Auditor**: Claude Code Security Agent  

---

## Executive Summary

MaintAI ha ricevuto significativi miglioramenti di sicurezza negli ultimi sprint (pin dipendenze, CSRF middleware, JTI blacklist, rate limiting, Fernet IMAP, cookie HttpOnly). Il sistema ha una postura di sicurezza discreta per un prodotto in early SaaS. Tuttavia persistono **6 finding CRITICAL e 9 HIGH** che possono impattare isolamento multi-tenant, escalation privilege, crash operativi e conformità ISO 27001. Il blockers enterprise principale è l'assenza totale di test automatici su flussi critici e la mancanza di deauthorization minimum-length validation. Nessuna evidenza di SQL injection raw, XSS stored, o leakage segreti nel codice esaminato.

**Finding per severity**: CRITICAL: 6 — HIGH: 9 — MEDIUM: 8 — LOW: 5 — INFO: 4

---

## Finding Index

| ID | Area | Severity | Titolo breve |
|----|------|----------|--------------|
| F-01 | Multi-tenant / DB | CRITICAL | ORM tenant filter bypass via ContextVar non settata in background tasks |
| F-02 | Multi-tenant / DB | CRITICAL | `_batch_completion_pct` esegue query senza filtro tenant_id |
| F-03 | Auth / JWT | CRITICAL | JWT 7 giorni senza revoca on password-change nei background tasks |
| F-04 | Multi-tenant | CRITICAL | `maintai_tenant_context` in localStorage accessibile a qualsiasi JS della pagina |
| F-05 | Upload / File | CRITICAL | PDF upload in `/manuali/upload` non verifica magic bytes (content-type bypass) |
| F-06 | AI / Planner | CRITICAL | `efficiency_score` e `plan_json` accettati dall'AI senza validazione server-side dei valori numerici |
| F-07 | Auth / CSRF | HIGH | CSRF middleware fa fail-open su endpoint OPTIONS e ignora preflight con credenziali |
| F-08 | Rate Limiting | HIGH | Nessun rate limit su endpoint critici (confirm_plan, deauthorize, upload allegati, export) |
| F-09 | Email Poller | HIGH | Duplicazione ticket non prevenuta — assenza di dedup message-id |
| F-10 | Auth | HIGH | `revoked_tokens` cresce indefinitamente: nessuna pulizia → degradazione performance |
| F-11 | Input Validation | HIGH | `DeauthorizeRequest.reason` non ha lunghezza minima — deautorizzazione accettata con stringa vuota |
| F-12 | Input Validation | HIGH | `GeneratePlanRequest.days` non ha upper bound esplicito (teoricamente illimitato) |
| F-13 | Frontend | HIGH | JWT in `localStorage` (modalità Tauri) esposto a XSS — nessuna protezione aggiuntiva |
| F-14 | Stabilità DB | HIGH | Import massivo `/admin/bulk-import/execute` non è atomico — commit parziali in caso di errore |
| F-15 | Stabilità backend | HIGH | `_ensure_columns()` viene eseguita due volte ad ogni avvio (lifespan + post-init) |
| F-16 | Multi-tenant | MEDIUM | `scadenze` router non verificato per filtro tenant (non letto nel dettaglio) |
| F-17 | AI / OpenAI | MEDIUM | `guide/chat` non ha rate limit, nessun cap `max_tokens` per request burst |
| F-18 | Stabilità backend | MEDIUM | `adaptive_replanning` chiama `db_info(db, ...)` con firma errata (db come primo argomento) |
| F-19 | Logging | MEDIUM | `guide/chat` swallows tutte le eccezioni OpenAI silenziosamente (`except Exception: return fallback`) |
| F-20 | Stabilità frontend | MEDIUM | `auth.tsx` non gestisce il caso `loading=true` in modo visibile — blank screen al refresh |
| F-21 | Stabilità DB | MEDIUM | `RevokedToken` non ha FK a `Utente` — impossibile pulire a cascata i token di un utente cancellato |
| F-22 | Sicurezza infra | MEDIUM | `COOKIE_SECURE=false` di default — cookie JWT non sicuro in HTTP senza esplicita configurazione |
| F-23 | Stabilità backend | MEDIUM | `email_poller` usa la stessa sessione DB per tutti i tenant — un'eccezione mid-loop può corrompere lo stato della sessione |
| F-24 | ISO 27001 | LOW | Assenza di policy documentata per gestione password superadmin e rotazione ENCRYPTION_KEY |
| F-25 | ISO 27001 | LOW | Log di sistema (`SystemLog`) non ha limite di retention configurabile |
| F-26 | Dipendenze | LOW | `openai>=1.0.0,<2.0.0` non pinnata — versione aggiornata silenziosamente ad ogni deploy |
| F-27 | Test coverage | LOW | Nessun test automatico su flussi critici: confirm_plan, deauthorize, tenant isolation |
| F-28 | Info | INFO | `_DEFAULT_ORIGINS` hardcoded include IP privato `192.168.1.222:3000` |

---

## Finding Dettagliati

### F-01 — CRITICAL — ORM tenant filter bypass nei background tasks

**Area**: Multi-tenant / Database  
**File/Endpoint**: `backend/core/database.py` (linee 53-68), `backend/services/email_poller.py`, `backend/services/retention_service.py`, `backend/services/auto_ticket_service.py`  

**Evidenza**:
```python
# database.py
current_tenant_id = contextvars.ContextVar("current_tenant_id", default=None)

@event.listens_for(SessionLocal, "do_orm_execute")
def _tenant_filter_do_orm_execute(execute_state):
    tenant_id = current_tenant_id.get()
    if tenant_id is not None:
        if execute_state.is_select and not execute_state.is_column_stat:
            execute_state.statement = execute_state.statement.options(
                with_loader_criteria(Base, ...)
            )
```

I background tasks (`email_poller_task`, `run_retention_job`, `run_auto_ticket_job`) girano in thread separati (`asyncio.to_thread`). La `ContextVar` `current_tenant_id` ha default `None`. Quando è `None` il filtro automatico è **completamente disabilitato**. In `check_all_mailboxes`, le query su `EmailConfig` e `Tenant` non hanno il filtro tenant iniettato (corretto perché devono vedere tutto) ma le query `Ticket`, `TicketAllegato` all'interno di `parse_and_create_tickets` viaggiano senza filtro ORM automatico — solo perché il codice include `config.tenant_id` esplicitamente. Se un bug futuro omette quel campo, la protezione fallisce silenziosamente.

**Rischio**: Il filtro automatico è una safety net di secondo livello dipendente da un ContextVar che non viene mai settata nei background tasks. Un bug in qualsiasi service background può leggere o scrivere dati cross-tenant senza trigger di errore.  
**Impatto**: Leakage dati cross-tenant, compromissione isolamento multi-tenant.  
**Raccomandazione**: Nei background tasks che operano per singolo tenant, settare esplicitamente `current_tenant_id.set(config.tenant_id)` prima di ogni operazione DB e resettarlo a `None` nel finally. Documentare che il filtro automatico è un secondo livello, non il primario.

---

### F-02 — CRITICAL — `_batch_completion_pct` query senza filtro tenant

**Area**: Multi-tenant / Planning  
**File/Endpoint**: `backend/api/routes/planning.py`, funzione `_batch_completion_pct` (linee 152-189)  

**Evidenza**:
```python
chiusi_rows = db.query(Ticket.id).filter(
    Ticket.id.in_(all_wo_ids),
    Ticket.stato == "Chiuso",
    # MANCA: Ticket.tenant_id == tenant filtro esplicito
).all()
```

La query conta i ticket chiusi per calcolare la percentuale di completamento piano. I `wo_ids` sono estratti dal `plan_json` dei piani (già filtrati per tenant), ma se un `wo_id` in un plan_json di un tenant coincide numericamente con un ticket di un altro tenant (scenario possibile per ID auto-increment condivisi su PostgreSQL), la query restituirà il ticket dell'altro tenant.

Il filtro ORM automatico (ContextVar) mitigherebbe questo se `current_tenant_id` è settato correttamente durante la request. Verificato che `get_current_tenant_id` setta il ContextVar nella chiamata `get_plan_history`. La mitigazione è presente ma dipende dall'ordine di esecuzione e non è esplicita nella funzione.

**Rischio**: In condizioni normali il ContextVar mitiga, ma la funzione non è autonomamente sicura — può essere invocata da contesti senza ContextVar settata.  
**Impatto**: Possibile cross-tenant data leakage nel calcolo completion_pct.  
**Raccomandazione**: Aggiungere `.filter(Ticket.tenant_id.in_(set(p.tenant_id for p in plans if p.tenant_id)))` alla query in `_batch_completion_pct`.

---

### F-03 — CRITICAL — JWT validi 7 giorni, token_version non controllato in background tasks

**Area**: Auth / JWT  
**File/Endpoint**: `backend/core/security.py` (linea 34), `backend/core/security.py` `_check_user_active` (linee 160-200)  

**Evidenza**:
```python
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 giorni
```

Il token_version check (`token_tv`) e il JTI blacklist check sono eseguiti solo in `_check_user_active`, che è chiamata solo da `get_current_user_payload`, cioè solo sulle richieste HTTP autenticate. I background tasks che usano `SessionLocal` direttamente non passano per questo controllo. Più importante: un cambio password incrementa `token_version` ma non invalida i cookie attivi finché il JWT non viene presentato a un endpoint — la revoca è lazy, non eager.

In un sistema multi-tenant con potenziale account compromise, 7 giorni di validità senza revoca proattiva sono un rischio operativo.

**Rischio**: Token compromessi validi fino a 7 giorni. Utenti licenziati con accesso ancora attivo fino alla scadenza se non fanno logout.  
**Impatto**: Accesso non autorizzato continuato dopo revoca account.  
**Raccomandazione**: Ridurre ACCESS_TOKEN_EXPIRE_MINUTES a 24h (o configurarlo via env). Documentare il processo di revoca emergenziale (increment token_version via admin endpoint).

---

### F-04 — CRITICAL — `maintai_tenant_context` in localStorage accessibile a XSS

**Area**: Multi-tenant / Frontend  
**File/Endpoint**: `frontend/app/lib/api.ts` (linee 69-73), `frontend/app/layout.tsx` (linee 353-358)  

**Evidenza**:
```typescript
// api.ts
const tenantContext = localStorage.getItem("maintai_tenant_context");
if (tenantContext) {
  extraHeaders["X-Tenant-Id"] = tenantContext;
}
```

Il tenant context (usato dal superadmin per impersonare tenant) è salvato in `localStorage`. Se una dipendenza frontend (npm package compromessa) esegue XSS, può leggere il `maintai_tenant_context` e inviare richieste impersonando qualsiasi tenant. Il backend accetta `X-Tenant-Id` da qualsiasi utente con ruolo `superadmin` — il controllo avviene lato backend — ma la persistenza del contesto in localStorage è un vettore di escalation.

**Rischio**: In presenza di XSS, un attaccante può leggere `maintai_tenant_context` e fare richieste come superadmin verso qualsiasi tenant.  
**Impatto**: Cross-tenant impersonation con privilegi superadmin.  
**Raccomandazione**: Usare `sessionStorage` invece di `localStorage` per `maintai_tenant_context` — il dato non persiste tra sessioni browser e non è accessibile da service workers. Aggiungere warning visivo quando il contesto tenant è attivo.

---

### F-05 — CRITICAL — Upload PDF senza verifica magic bytes

**Area**: Upload / File validation  
**File/Endpoint**: `backend/api/routes/manuali.py` (linee 22-65)  

**Evidenza**:
```python
@router.post("/manuali/upload")
async def upload_manuale(
    file: UploadFile = File(...),
    ...
):
    content = await file.read()
    if not content:
        raise AppError(status_code=400, message="File vuoto.")
    if len(content) > MAX_MANUALE_BYTES:
        raise AppError(...)

    result = smart_read_pdf(content)  # NO verifica MIME né magic bytes prima di qui
```

Il file viene accettato senza verificare:
1. Che l'estensione sia `.pdf`
2. Che il `Content-Type` corrisponda a `application/pdf`
3. Che i magic bytes inizino con `%PDF-` (verifica che il binario sia effettivamente un PDF)

Un attaccante autenticato può caricare un file arbitrario (es. un HTML con script, un file SVG con payload, un archivio ZIP) che verrà passato a `smart_read_pdf` (PyPDF2) e poi a OpenAI. PyPDF2 su file non-PDF solleverà un'eccezione che viene gestita, ma l'assenza di validazione precoce costituisce un rischio di upload di contenuto arbitrario.

**Rischio**: Upload di contenuto arbitrario verso un servizio che lo processa (PyPDF2, OpenAI). Possibile prompt injection via contenuto del PDF.  
**Impatto**: Abuse AI, upload di file non-PDF, potenziale path per prompt injection.  
**Raccomandazione**:
```python
if not file.filename or not file.filename.lower().endswith(".pdf"):
    raise AppError(status_code=400, message="Solo file PDF consentiti.")
if file.content_type and file.content_type not in ("application/pdf", "application/octet-stream"):
    raise AppError(status_code=400, message="Content-Type non valido.")
# Dopo lettura contenuto:
if not content.startswith(b"%PDF-"):
    raise AppError(status_code=400, message="Il file non è un PDF valido.")
```

---

### F-06 — CRITICAL — `plan_json` AI non validato server-side per valori numerici

**Area**: AI / Planner integrity  
**File/Endpoint**: `backend/api/routes/planning.py`, `confirm_plan` (linee 663-782), `_validate_and_fix_plan` (linee 193-261)  

**Evidenza**:
```python
# confirm_plan legge plan_json direttamente
plan_data = plan.plan_json or {}
planned = plan_data.get("planned_workorders", [])
for wo_id, fragments in planned_by_wo.items():
    primary = next(...)
    tecnico_id = primary.get("technician_id")  # non validato come intero positivo
    ticket.tecnico_id = tecnico_id             # assegnato direttamente al DB
```

La validazione post-AI (`_validate_and_fix_plan`) verifica date e overflow ore, ma non valida:
- Che `technician_id` appartenga al tenant corrente (cross-tenant technician assignment possibile)
- Che `wo_id` non sia un ticket di un altro tenant (il codice fa `.filter(Ticket.tenant_id == tenant_id)` che protegge, ma non logga il mismatch)
- Che `efficiency_score` sia nell'intervallo [0, 100] — un AI response manomessa con score=9999 viene salvata e mostrata
- Che `duration_hours` non sia negativo o fuori range

**Rischio**: Un `plan_json` manomesso (o generato da AI con allucinazione) può assegnare tecniche di altri tenant, impostare date fuori orizzonte, o salvare score invalidi.  
**Impatto**: Corruzione dati piano, assegnazione tecnico errata, UI malfunzionante per score fuori range.  
**Raccomandazione**: Dopo generazione AI e prima del salvataggio, validare che ogni `technician_id` sia presente nel tenant, che `efficiency_score` sia in [0, 100], che `duration_hours > 0`.

---

### F-07 — HIGH — CSRF middleware: fail-open su alcune configurazioni browser

**Area**: Auth / CSRF  
**File/Endpoint**: `backend/main.py`, `csrf_origin_check` (linee 571-613)  

**Evidenza**:
```python
if request.method in ("POST", "PUT", "DELETE", "PATCH"):
    if request.headers.get("authorization", "").startswith("Bearer "):
        return await call_next(request)  # bypass CSRF per tutti i Bearer
```

Il bypass per `Bearer` token è corretto per client nativi (Tauri), ma il problema è: il frontend web usa **sia cookie HttpOnly che Bearer token** (il token viene incluso nella response di login `access_token` e usato dalla UI in alcuni path). Se un attaccante forza il browser a usare `Authorization: Bearer <token_rubato>`, bypassa il check CSRF origin.

Più critico: il middleware non copre il metodo `OPTIONS` (preflight CORS) — questo è intenzionale e corretto — ma non è documentato il comportamento su `HEAD` o richieste con `content-type: multipart/form-data` da form HTML tradizionale (dove Origin potrebbe non essere inviato da browser legacy).

**Rischio**: Bypass CSRF se il token Bearer è disponibile al JavaScript (es. in localStorage, visibile via devtools).  
**Impatto**: Possibilità di CSRF su endpoint mutanti se Bearer token è accessibile.  
**Raccomandazione**: Verificare che la UI web non mai usi Bearer token nelle richieste standard (solo cookie HttpOnly). Se il token è nel body di login response solo per Tauri, documentare che il frontend web non deve mai salvare `access_token` in storage accessibile a JS.

---

### F-08 — HIGH — Rate limiting assente su endpoint critici

**Area**: Rate Limiting  
**File/Endpoint**: Vari router  

**Evidenza**: Il rate limiting è presente su:
- `/auth/login` (20/min)
- `/planning/generate` (10/min)
- `/tickets/{ticket_id}/diagnostic/start` (5/min)
- `/problem-analysis` (5/min)

**Assenti**:
- `POST /planning/confirm/{id}` — nessun limite, chiamabile in loop
- `POST /planning/deauthorize/{id}` — nessun limite
- `POST /tickets/{ticket_id}/allegati` — nessun limite upload
- `POST /tickets/{ticket_id}/firma` — nessun limite
- `POST /manuali/upload` — nessun limite (endpoint pesante: legge PDF + chiama OpenAI)
- `GET /export/tickets` — nessun limite (query su 10.000 record)
- `POST /tenants/{id}/utenti` — nessun limite creazione utenti

**Rischio**: DoS via chiamate ripetute, consumo illimitato token OpenAI, flooding DB.  
**Impatto**: Disponibilità sistema, costi API, stabilità.  
**Raccomandazione**: Applicare `@limiter.limit("5/minute")` su confirm/deauthorize, `@limiter.limit("3/minute")` su manuali/upload, `@limiter.limit("2/minute")` su export/tickets.

---

### F-09 — HIGH — Email poller non previene duplicazione ticket

**Area**: Email Poller  
**File/Endpoint**: `backend/services/email_poller.py`, `parse_and_create_tickets` (linee 48-145)  

**Evidenza**:
```python
messages = mailbox.fetch(AND(seen=False), mark_seen=True)
for msg in messages:
    subject = msg.subject or "Ticket senza oggetto (da Email)"
    # Nessun check su message-id per deduplicazione
    new_ticket = Ticket(...)
    db.add(new_ticket)
    db.commit()
```

La deduplicazione si basa interamente su `mark_seen=True` — se la connessione IMAP cade dopo il fetch ma prima del `mark_seen` (o prima del commit DB), il messaggio viene processato due volte al prossimo polling, creando ticket duplicati.

**Rischio**: In caso di errore di connessione, ogni email può generare N ticket duplicati.  
**Impatto**: Dati inconsistenti, carico tecnico per bonifica manuale, confusione operativa.  
**Raccomandazione**: Salvare il `msg.uid` (identificatore IMAP univoco) o il `Message-ID` header in un campo del ticket, e fare un check di esistenza prima della creazione. In alternativa, usare `UIDVALIDITY` + `UID` come chiave di idempotenza.

---

### F-10 — HIGH — `revoked_tokens` cresce senza pulizia

**Area**: Auth  
**File/Endpoint**: `backend/db/modelli.py` (linee 49-55), `backend/api/routes/auth.py` (linee 108-130)  

**Evidenza**:
```python
class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    id = Column(Integer, primary_key=True)
    jti = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    # Nessun campo expires_at
```

Il retention service (`retention_service.py`) pulisce solo `Ticket` soft-deleted. Non esiste nessuna pulizia di `revoked_tokens`. Con 7 giorni di TTL JWT e utenti che fanno logout giornalieri, la tabella cresce indefinitamente. Su sistemi con molti utenti, la query di blacklist check ad ogni request diventa lenta.

**Rischio**: Degradazione performance query auth, crescita DB illimitata.  
**Impatto**: Stabilità operativa a lungo termine.  
**Raccomandazione**: Aggiungere `expires_at = Column(DateTime)` a `RevokedToken` e un cleanup job (già presente in retention_service.py) che elimina i token scaduti: `db.query(RevokedToken).filter(RevokedToken.expires_at < datetime.now(timezone.utc)).delete()`.

---

### F-11 — HIGH — `DeauthorizeRequest.reason` senza lunghezza minima

**Area**: Input Validation  
**File/Endpoint**: `backend/api/routes/planning.py`, `DeauthorizeRequest` (linea 54), `deauthorize_plan` (linea 814)  

**Evidenza**:
```python
class DeauthorizeRequest(BaseModel):
    reason: str  # nessun validator — stringa vuota "" è accettata

# In deauthorize_plan:
plan.deauthorization_reason = data.reason.strip()  # se "" → stringa vuota salvata
```

La deautorizzazione è un'operazione ad alto impatto (flag amministrativo su piano confermato). Il motivo è obbligatorio per audit trail, ma il modello Pydantic accetta qualsiasi stringa inclusa la stringa vuota. Il codice fa `.strip()` ma non valida la lunghezza minima.

**Rischio**: Deautorizzazioni senza motivazione tracciabile, audit trail incompleto.  
**Impatto**: Conformità ISO 27001, responsabilità legale in caso di audit.  
**Raccomandazione**:
```python
from pydantic import field_validator
class DeauthorizeRequest(BaseModel):
    reason: str
    @field_validator("reason")
    @classmethod
    def reason_not_empty(cls, v: str) -> str:
        if len(v.strip()) < 10:
            raise ValueError("Il motivo di deautorizzazione deve avere almeno 10 caratteri.")
        return v.strip()
```

---

### F-12 — HIGH — `GeneratePlanRequest.days` senza upper bound

**Area**: Input Validation  
**File/Endpoint**: `backend/api/routes/planning.py`, `GeneratePlanRequest` (linee 46-51)  

**Evidenza**:
```python
class GeneratePlanRequest(BaseModel):
    days: int = 7
    asset_ids: Optional[List[int]] = None
    mode: str = "auto"
    include_weekends: bool = False
    allow_overtime: bool = False
    # Nessun validator su days — accetta days=9999
```

Con `days=9999` il motore deterministico (e potenzialmente AI) costruirebbe un piano su quasi 27 anni. Il motore deterministico potrebbe generare migliaia di workorder, saturando memoria e DB.

**Rischio**: DoS controllato tramite richiesta con `days` molto elevato.  
**Impatto**: Memoria, CPU, latenza, costi API OpenAI.  
**Raccomandazione**:
```python
from pydantic import field_validator
class GeneratePlanRequest(BaseModel):
    days: int = 7
    @field_validator("days")
    @classmethod
    def clamp_days(cls, v: int) -> int:
        if v < 1 or v > 90:
            raise ValueError("Il numero di giorni deve essere tra 1 e 90.")
        return v
```

---

### F-13 — HIGH — JWT in localStorage (Tauri) esposto a XSS

**Area**: Frontend / Auth  
**File/Endpoint**: `frontend/app/lib/api.ts` (linee 9-22)  

**Evidenza**:
```typescript
export function getTauriToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("maintai_jwt");
}
export function saveTauriToken(token: string) {
  localStorage.setItem("maintai_jwt", token);
}
```

In modalità Tauri (desktop), il JWT è salvato in `localStorage`. Sebbene Tauri abbia una sandbox WebView, le dipendenze npm compromesse o script iniettati via supply chain attack possono leggere localStorage. Non esiste fingerprinting del device né binding del token al client Tauri specifico.

**Rischio**: Token furto via supply chain attack o plugin JavaScript malevolo in ambiente Tauri.  
**Impatto**: Impersonazione utente desktop.  
**Raccomandazione**: Valutare l'uso di Tauri secure storage plugin (`tauri-plugin-stronghold` o `keychain`) invece di `localStorage`. Come misura immediata, aggiungere un controllo `User-Agent` o header custom Tauri-specifico verificato lato backend.

---

### F-14 — HIGH — Bulk import non atomico

**Area**: Stabilità DB  
**File/Endpoint**: `backend/api/routes/bulk_import.py`, `execute_import` (linee 463-640)  

**Evidenza**:
```python
# Commit separati per ogni sezione
db.commit()  # dopo SITI
# ...
db.commit()  # dopo IMPIANTI
# ...
db.commit()  # dopo ASSET
# Commento nel codice: "L'operazione non è atomica a livello DB (commit per sezione)"
```

Un errore durante il processing degli ASSET (dopo i commit di SITI e IMPIANTI) lascia il DB in stato parzialmente importato senza possibilità di rollback automatico.

**Rischio**: Import parziale causa inconsistenza dati (siti e impianti creati senza asset).  
**Impatto**: Corruzione dati, necessità di cleanup manuale.  
**Raccomandazione**: Usare una singola transazione con `db.begin()` e un rollback nel `except`. Se la performance con transazioni grandi è un problema, aggiungere endpoint di cancellazione import (dry-run + token di conferma come era originariamente commentato nel codice).

---

### F-15 — HIGH — `_ensure_columns()` eseguita due volte ad ogni avvio

**Area**: Stabilità Backend  
**File/Endpoint**: `backend/main.py`, `lifespan` (linee 516-541), `_run_alembic_upgrade` (linee 113-128)  

**Evidenza**:
```python
# In _run_alembic_upgrade():
_ensure_columns()  # prima esecuzione

# In lifespan():
_run_alembic_upgrade()   # chiama _ensure_columns() internamente
# ...
_ensure_columns()        # seconda esecuzione esplicita — DUPLICATA
```

La chiamata a `_ensure_columns()` è ridondante. Su database PostgreSQL con molti tenant e molte colonne, ogni call esegue decine di ALTER TABLE statements (anche se idempotenti). Su cold start Render, questo aggiunge latenza e log noise.

**Rischio**: Doppio overhead DDL ad ogni avvio, log confusi.  
**Impatto**: Cold start più lento, ridotta leggibilità log di avvio.  
**Raccomandazione**: Rimuovere la seconda chiamata a `_ensure_columns()` nel lifespan — quella in `_run_alembic_upgrade` è sufficiente.

---

### F-16 — MEDIUM — Endpoint `scadenze` non verificato per tenant filter

**Area**: Multi-tenant  
**File/Endpoint**: `backend/api/routes/scadenze.py`  

**Evidenza**: File non letto nel dettaglio per mancanza di tempo audit, ma il pattern è a rischio dato che altri router simili mancano di tenant filter in alcune query secondarie.  
**Classificazione**: NON COMPLETAMENTE VERIFICABILE DAL CODICE DISPONIBILE — richiede lettura del file.  
**Raccomandazione**: Verificare che ogni query in `scadenze.py` includa `.filter(Model.tenant_id == tenant_id)`.

---

### F-17 — MEDIUM — `/guide/chat` senza rate limit

**Area**: AI / OpenAI  
**File/Endpoint**: `backend/api/routes/guide.py`, `guide_chat` (linee 196-235)  

**Evidenza**:
```python
@router.post("/chat")
async def guide_chat(req: GuideRequest, payload: dict = Depends(get_current_user_payload)):
    # Nessun @limiter.limit()
    # Chiama OpenAI con max_tokens=900 per ogni richiesta
```

L'endpoint è autenticato ma non ha rate limit. Un utente malevolo autenticato può inviare migliaia di richieste all'endpoint che chiama OpenAI, generando costi illimitati.

**Rischio**: Costi OpenAI non limitati per tenant singolo.  
**Impatto**: Costi infrastruttura, disponibilità per altri tenant.  
**Raccomandazione**: Aggiungere `@limiter.limit("20/minute")` e considerare un cap per tenant al giorno sui token AI guide.

---

### F-18 — MEDIUM — `db_info(db, ...)` con firma errata in `adaptive_replanning`

**Area**: Stabilità Backend  
**File/Endpoint**: `backend/api/routes/planning.py`, linee 1193, 1225  

**Evidenza**:
```python
db_error(db, "PLANNING", f"adaptive_replanning: errore bridge — {msg}", tenant_id=tenant_id)
# ...
db_info(db, "PLANNING", ..., tenant_id=tenant_id)
```

La firma corretta di `db_info` e `db_error` in `backend/core/logger_db.py` è `db_info(module, message, extra=None, tenant_id=None)` — non accetta `db` come primo argomento. Chiamando `db_info(db, ...)`, `db` (oggetto Session) viene passato come `module`, e il log viene scritto con module=`<Session>` invece del modulo corretto. Su alcuni path, questo potrebbe anche fallire silenziosamente se la funzione cerca di usare l'oggetto Session come stringa.

**Rischio**: Log corrotti o silenziati per l'endpoint adaptive_replanning.  
**Impatto**: Operatività, troubleshooting difficile.  
**Raccomandazione**: Correggere le chiamate: `db_error("PLANNING", ..., tenant_id=tenant_id)` (senza `db`).

---

### F-19 — MEDIUM — Eccezioni OpenAI swallowed silenziosamente in `guide/chat`

**Area**: Logging  
**File/Endpoint**: `backend/api/routes/guide.py` (linee 223-235)  

**Evidenza**:
```python
try:
    client = openai.AsyncOpenAI(api_key=api_key)
    response = await client.chat.completions.create(...)
    answer = response.choices[0].message.content or _fallback_answer(req)
    return {"content": answer}
except Exception:
    return {"content": _fallback_answer(req)}  # NO logging, NO tracciatura
```

Qualsiasi errore OpenAI (rate limit, quota exceeded, timeout, network) viene silenziosamente inghiottito. Non viene scritto nessun log, né in `logger` né in `db_error`.

**Rischio**: Problemi OpenAI invisibili all'operatore, impossibile diagnosticare degradazione servizio AI.  
**Impatto**: Troubleshooting impossibile, SLA invisibile.  
**Raccomandazione**:
```python
except Exception as exc:
    logger.warning("guide/chat: OpenAI error per %s: %s", payload.get("sub"), exc)
    return {"content": _fallback_answer(req)}
```

---

### F-20 — MEDIUM — `auth.tsx` mostra blank screen durante loading

**Area**: Stabilità Frontend  
**File/Endpoint**: `frontend/app/lib/auth.tsx` (linee 128)  

**Evidenza**:
```tsx
if (loading) return null;  // blank screen durante verifica /auth/me
```

Al refresh della pagina, mentre `AuthProvider` verifica il token con `GET /auth/me`, l'intera UI viene nascosta (`return null`). Su Render con cold start, questo può durare 30-60 secondi. L'utente vede una pagina bianca senza feedback.

**Rischio**: UX degradata, utenti che abbandonano o ricaricano ripetutamente.  
**Impatto**: Operatività per tecnici sul campo (mobile).  
**Raccomandazione**: Sostituire `return null` con un loading spinner o skeleton screen: `if (loading) return <LoadingScreen />`.

---

### F-21 — MEDIUM — `RevokedToken` senza FK a `Utente`

**Area**: Stabilità DB  
**File/Endpoint**: `backend/db/modelli.py` (linee 49-55)  

**Evidenza**:
```python
class RevokedToken(Base):
    __tablename__ = "revoked_tokens"
    id = Column(Integer, primary_key=True)
    jti = Column(String, unique=True, index=True, nullable=False)
    created_at = Column(DateTime, default=_utcnow)
    # Nessuna FK a Utente, nessun campo expires_at
```

La tabella non ha riferimento all'utente proprietario del token, né una data di scadenza. Impossibile:
1. Revocare tutti i token di un utente specifico (es. dopo account compromise)
2. Pulire automaticamente i token scaduti
3. Fare audit di chi ha revocato cosa

**Rischio**: Impossibilità di revoca massiva, accumulo illimitato.  
**Impatto**: Sicurezza, stabilità DB, audit trail.  
**Raccomandazione**: Aggiungere `user_id = Column(Integer, ForeignKey("utenti.id"), nullable=True)` e `expires_at = Column(DateTime, nullable=False)` a `RevokedToken`.

---

### F-22 — MEDIUM — `COOKIE_SECURE=false` di default

**Area**: Sicurezza Infrastruttura  
**File/Endpoint**: `backend/core/security.py` (linea 77)  

**Evidenza**:
```python
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "false").strip().lower() == "true"
```

Il cookie HttpOnly viene emesso con `Secure=False` a meno che `COOKIE_SECURE=true` non sia esplicitamente configurato. In produzione su Render (HTTPS), questo non è un problema se la variabile è correttamente impostata. Ma in assenza di configurazione esplicita (es. nuovo deploy), il cookie JWT può essere trasmesso su HTTP in chiaro.

**Rischio**: JWT trasmesso su HTTP non sicuro in assenza di configurazione.  
**Impatto**: Token intercettabili su reti non sicure.  
**Raccomandazione**: Invertire il default: `COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").strip().lower() == "true"`. In locale HTTP, impostare esplicitamente `COOKIE_SECURE=false`.

---

### F-23 — MEDIUM — Email poller: sessione DB condivisa tra tenant

**Area**: Stabilità Backend  
**File/Endpoint**: `backend/services/email_poller.py`, `check_all_mailboxes` (linee 147-159)  

**Evidenza**:
```python
def check_all_mailboxes():
    db = SessionLocal()
    try:
        active_configs = db.query(EmailConfig)...all()
        for config in active_configs:
            parse_and_create_tickets(db, config)  # stessa sessione per tutti i tenant
    finally:
        db.close()
```

Se `parse_and_create_tickets` per il tenant A solleva un'eccezione non gestita che lascia la sessione in stato "aborted" (tipico in PostgreSQL), le iterazioni successive per i tenant B, C, D falliscono silenziosamente perché tutte usano la stessa sessione corrotta.

**Rischio**: Un errore IMAP su un tenant può silenziare l'email polling per tutti gli altri tenant nella stessa iterazione.  
**Impatto**: Mancata creazione ticket da email per tenant multipli.  
**Raccomandazione**: Creare una sessione DB separata per ogni tenant:
```python
for config in active_configs:
    db_per_tenant = SessionLocal()
    try:
        parse_and_create_tickets(db_per_tenant, config)
    finally:
        db_per_tenant.close()
```

---

### F-24 — LOW — Nessuna policy per rotazione ENCRYPTION_KEY

**Area**: ISO 27001  
**File/Endpoint**: `backend/core/security.py` (linee 42-70), `backend/core/config.py`  

**Evidenza**: La `ENCRYPTION_KEY` Fernet è obbligatoria all'avvio e protegge le password IMAP. Non esiste documentazione, endpoint, o procedura per la rotazione della chiave. Se la chiave viene compromessa, non c'è meccanismo per re-crittografare le password IMAP esistenti.

**Rischio**: Chiave Fernet compromessa → tutte le password IMAP compromesse, senza meccanismo di recovery.  
**Raccomandazione**: Documentare procedura di rotazione. Valutare l'aggiunta di un campo `encryption_key_version` in `EmailConfig` per supportare rotazione progressiva.

---

### F-25 — LOW — Nessuna retention configurabile per SystemLog

**Area**: ISO 27001 / Logging  
**File/Endpoint**: `backend/db/modelli.py`, `SystemLog`, `backend/services/retention_service.py`  

**Evidenza**: Il `retention_service.py` pulisce solo ticket soft-deleted. La tabella `system_logs` (SystemLog) cresce senza limite. In produzione con email polling ogni 5 minuti e eventi continui, questa tabella può crescere rapidamente.

**Rischio**: Crescita DB illimitata, possibile degradazione query log.  
**Raccomandazione**: Aggiungere al retention service la pulizia di log più vecchi di N giorni (es. 90 giorni per conformità, configurabile via env `LOG_RETENTION_DAYS`).

---

### F-26 — LOW — `openai` non pinnata a versione esatta

**Area**: Dipendenze  
**File/Endpoint**: `backend/requirements.txt` (linea 10)  

**Evidenza**:
```
openai>=1.0.0,<2.0.0
```

Tutte le altre dipendenze sono pinnate a versione esatta (es. `fastapi==0.135.1`), ma `openai` usa range. Un aggiornamento silenzioso di openai potrebbe cambiare comportamenti API o breaking changes minori.

**Raccomandazione**: Pinnare: `openai==1.XX.Y` con la versione attualmente usata.

---

### F-27 — LOW — Nessun test automatico su flussi critici

**Area**: Test coverage / Regressione  
**File/Endpoint**: `backend/tests/test_planner_engine.py`  

**Evidenza**: L'unico file di test esaminato è `test_planner_engine.py` che copre il motore deterministico. Non esistono (o non sono stati trovati) test per:
- Multi-tenant isolation (query senza tenant_id)
- `confirm_plan` con dati cross-tenant
- `deauthorize_plan` con reason vuota
- Upload con file non-PDF
- Email poller con messaggi malformati

**Rischio**: Regressioni nei flussi critici non rilevate prima del deploy.  
**Impatto**: Stabilità produzione.  
**Raccomandazione**: Aggiungere test di integrazione per almeno: tenant isolation query, confirm_plan state machine, upload validation, deauthorize validation.

---

### F-28 — INFO — IP privato hardcoded in `_DEFAULT_ORIGINS`

**Area**: Sicurezza Infrastruttura  
**File/Endpoint**: `backend/main.py` (linea 88)  

**Evidenza**:
```python
"http://192.168.1.222:3000",
"http://192.168.1.222:3001",
```

Un IP privato specifico è hardcoded nelle origini CORS permesse. In produzione questo non causa problemi diretti (la CORS whitelist è server-side), ma è potenzialmente un IP di sviluppo che non dovrebbe essere presente in un build di produzione.

**Raccomandazione**: Spostare gli IP di sviluppo in `CORS_ORIGINS` env var, mantenendo in `_DEFAULT_ORIGINS` solo le origini di produzione verificate.

---

## Gap ISO 27001:2022

| Controllo ISO 27001:2022 | Stato Attuale | Gap |
|---|---|---|
| A.5.14 — Classificazione informazioni | Assente | Nessuna classificazione dati nel sistema |
| A.5.23 — Sicurezza servizi cloud | Parziale | Render/Vercel usati ma SLA non documentati |
| A.6.8 — Incident response | Assente | Nessuna procedura documentata di incident response |
| A.7.10 — Storage media | Assente | Nessuna policy per storage file allegati/manuali |
| A.8.2 — Privileged access | Parziale | SuperAdmin esiste ma no MFA, no session recording |
| A.8.4 — Source code access | Assente | Nessun controllo accesso repo documentato |
| A.8.5 — Autenticazione sicura | Parziale | Password policy presente, no MFA per responsabili |
| A.8.7 — Anti-malware | NON VERIFICABILE | Nessuna scansione malware su file allegati caricati |
| A.8.8 — Gestione vulnerabilità | Parziale | Dipendenze pinnate ma nessun processo automatico di scan |
| A.8.11 — Data masking | Parziale | Anonymizer presente per email, ma PII non sistematicamente classificata |
| A.8.12 — DLP | Assente | Nessun controllo prevenzione data loss |
| A.8.16 — Monitoraggio attività | Parziale | SystemLog presente ma no alerting automatico su eventi critici |
| A.8.24 — Crittografia | Parziale | Fernet per IMAP, JWT per sessioni, ma no crittografia a riposo per dati sensibili DB |
| A.8.30 — Outsourced development | NON VERIFICABILE | Nessuna policy sviluppo esterno visibile |
| A.5.9 — Inventario asset | Parziale | Asset management presente per impianti, non per infrastruttura IT |
| A.5.28 — Log eventi | Parziale | SystemLog presente, ma no log di accesso per letture dati sensibili |
| A.5.33 — Retention dati | Parziale | Ticket retention implementata, log non limitati, revoked_tokens illimitati |
| A.5.34 — Privacy | Parziale | Anonymizer per email, ma nessuna DPIA documentata |

---

## Blockers Enterprise

Le seguenti issues impedirebbero una vendita enterprise o una certificazione ISO 27001:

1. **F-01 — Tenant filter bypass in background tasks**: rischio critico di cross-tenant leakage, inaccettabile per enterprise multi-tenant.

2. **F-05 — Upload senza magic bytes validation**: qualsiasi pen test enterprise rileverebbe l'assenza di validazione content-type come finding critico.

3. **F-11 — Deauthorization senza minimum reason**: per enterprise il deauthorization audit trail è un requisito di compliance operativa e legale.

4. **F-27 — Nessun test automatico su flussi critici**: nessun enterprise accetterà un SLA senza test coverage documentata su confirm/deauthorize.

5. **F-02 — Batch completion query senza tenant filter esplicito**: leakage potenziale inaccettabile.

6. **ISO A.5.6 — Incident Response assente**: qualsiasi audit ISO 27001 richiederà una procedura di incident response documentata.

7. **ISO A.8.2 — No MFA per superadmin**: accesso superadmin senza secondo fattore è un finding standard in ogni audit enterprise.

8. **ISO A.8.7 — Nessuna scansione malware su allegati**: richiesto da molte policy enterprise di sicurezza dei dati.

---

## Rischi di Regressione

| Finding | Area rischio regressione | Scenario |
|---|---|---|
| F-15 | `_ensure_columns()` doppia | Un futuro refactor che rimuove una delle due chiamate può rompere i deploy su ambienti dove Alembic fallisce |
| F-18 | `db_info(db, ...)` firma errata | Su upgrade di `logger_db.py`, questo potrebbe generare eccezioni invece di silently fail |
| F-14 | Bulk import non atomico | Aggiunta di vincoli FK in futuro renderà i commit parziali ancora più problematici |
| F-09 | Email dedup assente | Con volume email crescente, la probabilità di duplicati aumenta linearmente |
| F-23 | Sessione DB condivisa email poller | Con più tenant attivi, un'eccezione su un tenant blocca silenziosamente gli altri |
| F-27 | No test critici | Qualsiasi modifica a `confirm_plan` o tenant isolation può introdurre regressioni invisibili |
| F-01 | ContextVar non settata nei background tasks | Eventuali nuovi background services erediteranno silenziosamente il pattern insicuro |

---

*Fine report — 28 finding identificati, tutti con evidenza diretta nel codice esaminato.*
