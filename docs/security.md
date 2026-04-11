# MaintAI — Audit di Sicurezza, Privacy e Stabilità

**Versione auditata:** 2.4.2
**Data audit:** 2026-04-11
**Ruolo auditor:** Principal Security Architect + Senior Privacy Engineer + Staff SRE
**Metodologia:** OWASP ASVS, OWASP Multi-Tenant Security, NIST SSDF, GDPR art.25/32, EDPB Privacy by Design

---

## Indice

1. [Executive Summary](#1-executive-summary)
2. [Architettura e flussi dati](#2-architettura-e-flussi-dati)
3. [Findings completi](#3-findings-completi)
4. [Isolamento multi-tenant](#4-isolamento-multi-tenant)
5. [GDPR e Privacy](#5-gdpr-e-privacy)
6. [Qualità e stabilità del codice](#6-qualità-e-stabilità-del-codice)
7. [Quick wins](#7-quick-wins)
8. [Blocchi critici pre-rilascio](#8-blocchi-critici-pre-rilascio)
9. [Piano di remediation](#9-piano-di-remediation)
10. [Patch plan](#10-patch-plan)
11. [Piano di test di regressione](#11-piano-di-test-di-regressione)

---

## 1. Executive Summary

Il sistema è funzionalmente solido per un prodotto in sviluppo attivo. L'architettura multi-tenant è concettualmente corretta e il codice mostra un livello di cura superiore alla media per un progetto di questa dimensione. Tuttavia esistono **4 blocchi critici** che rendono il sistema inadatto a una produzione seria con dati reali di clienti, e numerosi problemi di livello alto che richiedono attenzione immediata.

### Livello di rischio complessivo

| Area | Livello |
|---|---|
| Sicurezza generale | **HIGH RISK** |
| Isolamento multi-tenant | **MEDIUM-HIGH** |
| GDPR / Privacy | **HIGH RISK** |
| Stabilità operativa | **MEDIUM** |
| Qualità del codice | **MEDIUM** |

### Distribuzione finding

| Gravità | Quantità |
|---|---|
| CRITICAL | 4 |
| HIGH | 8 |
| MEDIUM | 9 |
| LOW | 3 |
| **Totale** | **24** |

---

## 2. Architettura e flussi dati

### Mappa componenti

```
[Browser]
  JWT in localStorage (7 giorni)
       │ fetch() con Bearer token
       ▼
[Next.js 15 su Vercel]
       │ HTTP con Authorization: Bearer
       ▼
[FastAPI su Render]
  22 router + /v1 duplicati
       │
  ┌────┴────────────────────┐
  ▼                         ▼
[SQLAlchemy ORM]      [OpenAI API]        [IMAP server]
[PostgreSQL / SQLite]  [gpt-4.1-mini]     [Email→Ticket]
       │
  ┌────┴────────┐
  ▼             ▼
[uploads/]  [system_logs]
(filesystem)  (tabella DB)
```

### Flussi di dati personali

| Flusso | Dati personali coinvolti | Destinazione |
|---|---|---|
| Email → Ticket | Mittente, corpo email, allegati | DB + filesystem `/uploads` |
| Ticket → AI planner | Titolo, descrizione, nome tecnico | OpenAI API (senza anonimizzazione) |
| Ticket → Export CSV | Tutti i campi ticket | File locale dell'utente |
| Log di sistema | Username, email mittente, operazioni | `system_logs` in DB |
| Sessione utente | Username, ruolo, tenant_id | `localStorage` browser |

### Confini tenant — stato attuale

```
✅ Tutti i modelli hanno tenant_id FK
✅ get_current_tenant_id() iniettato via Depends in ogni endpoint
✅ check_tenant_ownership() per cross-check asset/tecnici
⚠️  Superadmin senza X-Tenant-Id → tenant_id = None → query globale senza filtro
⚠️  File log su filesystem: nessun isolamento tenant
⚠️  Email poller: accede a tutte le EmailConfig (corretto per funzione, fragile per design)
```

---

## 3. Findings completi

---

### FINDING C-01
**Gravità:** CRITICAL | **Area:** Security
**Titolo:** `/db/reset-emergency` — Reset del database senza autenticazione JWT

**File:** `backend/api/routes/db_routes.py`, righe 56-69

**Descrizione tecnica:**

```python
@router.post("/db/reset-emergency")
def reset_emergency(secret: str = Query(...)):
    admin_secret = os.getenv("ADMIN_SECRET", "")
    if not admin_secret or secret != admin_secret:
        raise HTTPException(status_code=403, detail="Secret non valido.")
    Base.metadata.drop_all(bind=engine)   # ← drop TUTTE le tabelle
    init_db()
    return {"status": "ok", "message": "DB resettato. Login: admin/admin (superadmin)"}
```

L'endpoint è pubblico — non richiede JWT. L'unica protezione è un segreto passato come parametro query (`?secret=...`). Chiunque conosca o bruteforce il valore di `ADMIN_SECRET` può distruggere **tutti i dati di tutti i tenant** senza autenticazione, senza log, senza conferma. Se `ADMIN_SECRET` non è impostata nell'ambiente Render (situazione frequente in nuovi deploy), il check `not admin_secret` ritorna sempre 403, ma la presenza dell'endpoint rimane un rischio architetturale.

**Scenario di exploit:** `POST /db/reset-emergency?secret=maintai2024` → zero traccia nei log, perdita totale dei dati.

**Impatto:** Perdita irreversibile di tutti i dati di produzione. Violazione GDPR art.32 (integrità e disponibilità dei dati).

**Remediation:** Rimuovere completamente questo endpoint. Per emergenze operative, usare `POST /db/reset` (già protetto con JWT superadmin).

---

### FINDING C-02
**Gravità:** CRITICAL | **Area:** Security
**Titolo:** Chiave JWT hardcoded nel codice sorgente

**File:** `backend/core/security.py`, righe 8-11

**Descrizione tecnica:**

```python
_DEFAULT_JWT_SECRET = "super-secret-key-maintai-v2"
SECRET_KEY = os.getenv("JWT_SECRET", _DEFAULT_JWT_SECRET)
# Se JWT_SECRET non è in Render → usa la chiave di default
```

Se la variabile d'ambiente `JWT_SECRET` non è impostata nell'ambiente Render (o viene accidentalmente rimossa), il sistema usa la chiave `"super-secret-key-maintai-v2"` nota a chiunque abbia accesso al repository. Con questa chiave chiunque può **forgiare token JWT validi** per qualsiasi utente, incluso superadmin, con qualsiasi `tenant_id`.

**Scenario di exploit:**
```python
import jwt
token = jwt.encode(
    {"sub": "admin", "ruolo": "superadmin", "tenant_id": 1, "exp": 9999999999},
    "super-secret-key-maintai-v2",
    "HS256"
)
# → token superadmin valido senza credenziali
```

**Impatto:** Compromissione completa di tutti i tenant. Bypass totale dell'autenticazione.

**Remediation:** Rimuovere `_DEFAULT_JWT_SECRET`. Se `JWT_SECRET` manca, il server deve **rifiutarsi di avviarsi** con errore fatale, non usare un default insicuro.

---

### FINDING C-03
**Gravità:** CRITICAL | **Area:** Security / Privacy
**Titolo:** Chiave Fernet hardcoded — password IMAP decifrabili da chiunque

**File:** `backend/core/security.py`, righe 13-14

**Descrizione tecnica:**

```python
_DEFAULT_ENCRYPTION_KEY = "uO7U_6N-XyP2UvY_YyS7y8s5Y-Y9u8s7Y8s5Y-Y9u8s="
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", _DEFAULT_ENCRYPTION_KEY)
```

La chiave Fernet usata per cifrare le password IMAP nel database è hardcoded. Chiunque abbia accesso al codice può decifrare tutte le password IMAP memorizzate, compromettendo le caselle email configurate da tutti i tenant.

**Impatto:** Furto di credenziali email aziendali. Violazione GDPR art.5(1)(f) e art.32.

**Remediation:** Stesso approccio di C-02 — errore fatale se la chiave manca. Ruotare la chiave in produzione e re-cifrare i record esistenti.

---

### FINDING C-04
**Gravità:** CRITICAL | **Area:** Privacy / GDPR
**Titolo:** Dati personali inviati a OpenAI senza anonimizzazione

**File:** `backend/services/ai/anonymization_service.py` (esiste ma non usato), `backend/services/ai_planner_service.py`

**Descrizione tecnica:**

Il servizio di anonimizzazione (`AnonymizationService`) esiste come singleton pronto:
```python
# anonymization_service.py
anonymizer = AnonymizationService()  # presente ma mai chiamato
```

Ma non viene mai invocato nel flusso AI planning. Titoli ticket, descrizioni (che possono contenere nomi di persone, locazioni, dati operativi), e nomi dei tecnici vengono inviati a OpenAI API senza alcun preprocessing di anonimizzazione.

**Impatto GDPR:** Trasferimento a terzi (OpenAI, operante in USA) di dati personali di lavoratori (tecnici, mittenti email) senza base legale documentata, senza anonimizzazione, potenzialmente in violazione degli art.13-14 (informativa) e art.44+ (trasferimenti extra-UE).

**Remediation:** Collegare `anonymizer.anonymize_ticket_data()` nel flusso `collect_planning_context()` prima della costruzione del prompt. Verificare il DPA (Data Processing Agreement) con OpenAI.

---

### FINDING H-01
**Gravità:** HIGH | **Area:** Security
**Titolo:** Nessun rate limiting sul login — brute force illimitato

**File:** `backend/api/routes/auth.py:12`, `backend/core/rate_limiter.py`

**Descrizione tecnica:**

```python
# rate_limiter.py: slowapi è una dipendenza opzionale
RATE_LIMITING_AVAILABLE = False  # possibile in deploy se slowapi non installato

# auth.py: login senza @limiter.limit()
@router.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), ...):
    # nessun rate limit, nessun lockout, nessun CAPTCHA
```

Il sistema accetta tentativi di login illimitati. Le password di default del seed (`admin/admin`, `tecnico/tecnico`) rendono il brute force triviale.

**Scenario:** 10.000 tentativi al secondo su username noti (`admin`, `tecnico`). Password default trovate in millisecondi.

**Remediation:** Rate limiting obbligatorio (non opzionale) — max 5 tentativi/minuto per IP+username. Aggiungere `slowapi` a `requirements.txt` come dipendenza diretta, non condizionale.

---

### FINDING H-02
**Gravità:** HIGH | **Area:** Security
**Titolo:** JWT in `localStorage` — vulnerabilità XSS + 7 giorni di validità

**File:** `frontend/app/lib/auth.tsx:44,73-79`, `backend/core/security.py`

**Descrizione tecnica:**

```typescript
// auth.tsx
localStorage.setItem("maintai_jwt", token);  // accessibile a qualsiasi script JS

// security.py
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  // 7 giorni di validità
```

Qualsiasi script XSS (inclusi script di terze parti) può leggere il token JWT. La validità di 7 giorni massimizza la finestra di sfruttamento.

**Remediation:** Migrare a HttpOnly cookies (`SameSite=Strict`). Se localStorage è necessario, ridurre la validità a max 8 ore con refresh token separato.

---

### FINDING H-03
**Gravità:** HIGH | **Area:** Security
**Titolo:** Nessuna revoca token — cambio password e disabilitazione utente inefficaci

**File:** `backend/api/routes/auth.py:85-100`, `backend/api/routes/auth.py:27-31`

**Descrizione tecnica:**

Il cambio password non invalida i JWT esistenti. La disabilitazione utente (`is_active=False`) è verificata solo al login, non ad ogni richiesta autenticata. Un utente disabilitato può continuare a usare il suo JWT per tutti gli altri endpoint per i restanti giorni di validità.

**Scenario:** Tecnico licenziato → admin lo disabilita → il tecnico usa il suo JWT per altri 6 giorni su tutti gli endpoint API.

**Remediation:** Aggiungere controllo `is_active` e `tenant.is_active` in `get_current_user_payload` (o in middleware dedicato) ad ogni richiesta autenticata.

---

### FINDING H-04
**Gravità:** HIGH | **Area:** Security / Privacy
**Titolo:** Log su filesystem senza isolamento tenant — `responsabile` vede log globali

**File:** `backend/api/routes/logs.py:14-32`

**Descrizione tecnica:**

```python
@router.get("/logs")
def get_logs(lines: int = Query(100), payload: dict = Depends(get_current_user_payload)):
    if payload.get("ruolo") not in ["superadmin", "responsabile"]:
        raise HTTPException(status_code=403)
    with open(LOG_FILE, "r") as f:
        content = f.readlines()
    # Restituisce TUTTO il file — nessun filtro per tenant
```

Il file `maintai.log` contiene voci di tutti i tenant in un unico stream. Un `responsabile` del tenant A può leggere log di errori del tenant B, incluse email, username e descrizioni di ticket.

**Remediation:** Rimuovere l'endpoint `/logs` per i non-superadmin, o reindirizzare tutti al solo endpoint DB `/system-logs` che ha già il filtro per tenant.

---

### FINDING H-05
**Gravità:** HIGH | **Area:** Security
**Titolo:** `POST /db/reset` — cancellazione totale DB con un solo click superadmin

**File:** `backend/api/routes/db_routes.py:72-84`

**Descrizione tecnica:**

```python
@router.post("/db/reset")
def reset_database(_payload: dict = Depends(require_superadmin)):
    Base.metadata.drop_all(bind=engine)  # drop TUTTE le tabelle
    init_db()
    # Nessun log, nessuna conferma, nessun backup trigger
```

Un account superadmin compromesso, o un click accidentale da parte dell'operatore, distrugge tutti i dati di tutti i tenant. Nessun audit trail, nessuna conferma in due passaggi.

**Remediation:** Proteggere con flag env `ALLOW_RESET=true` (disabilitato di default in prod) + log obbligatorio dell'operazione + corpo JSON con campo `confirm: "RESET"` come secondo fattore.

---

### FINDING H-06
**Gravità:** HIGH | **Area:** Privacy / Stability
**Titolo:** Email HTML non sanitizzata salvata come corpo del ticket (stored XSS)

**File:** `backend/services/email_poller.py:44-51`

**Descrizione tecnica:**

```python
body = msg.text or msg.html or "Nessun corpo del messaggio fornito."
descrizione = (
    "--- Ticket generato automaticamente da Email ---\n\n"
    f"Da: {sender}\n"    # ← email del mittente (PII) salvata in chiaro
    f"Data: {date_str}\n\n"
    f"{body}"            # ← HTML grezzo salvato senza sanitizzazione
)
```

Se `msg.text` è assente (email HTML-only), l'HTML grezzo viene salvato in `descrizione`. Qualora il frontend rendesse questo campo come HTML, si avrebbe stored XSS. Inoltre l'indirizzo email del mittente (dato personale GDPR) viene memorizzato in chiaro sia nel body del ticket che nei log di sistema.

**Remediation:** Strippare l'HTML con `bleach.clean(html, tags=[], strip=True)`. Mascherare il mittente prima dello storage: `Da: [EMAIL]` invece dell'indirizzo reale.

---

### FINDING H-07
**Gravità:** HIGH | **Area:** Security
**Titolo:** Nessuna validazione lunghezza password

**File:** `backend/api/routes/auth.py:80-100`, `backend/api/routes/tenants.py`

**Descrizione tecnica:**

```python
class PasswordChange(BaseModel):
    current_password: str
    new_password: str  # nessun min_length, nessuna policy di complessità
```

Password di un singolo carattere sono accettate in tutti gli endpoint che le trattano (cambio password, creazione utente, reset superadmin). La stessa mancanza è nel nuovo endpoint `PUT /tenants/{id}/utenti/{id}/password`.

**Remediation:** `new_password: str = Field(..., min_length=8)` in tutti gli schema che gestiscono password.

---

### FINDING H-08
**Gravità:** HIGH | **Area:** Stability / Security
**Titolo:** Superadmin senza `X-Tenant-Id` — query globali senza filtro tenant

**File:** `backend/core/security.py:95-101`, `backend/repositories/ticket_repository.py:48-49`

**Descrizione tecnica:**

```python
# security.py: superadmin senza header → tenant_id = None
if ruolo == "superadmin":
    if x_tenant_id: return int(x_tenant_id)
    return int(tid) if tid else None  # ← None possibile

# ticket_repository.py: tenant_id None → nessun filtro applicato
if tenant_id is not None:
    query = query.filter(Ticket.tenant_id == tenant_id)
# → GET /tickets senza header = tutti i ticket di tutti i tenant
```

Un superadmin che chiama `GET /tickets` (o asset, manuali, piani) senza header `X-Tenant-Id` riceve dati di **tutti i tenant** in un unico payload non isolato.

**Remediation:** Documentare il comportamento e aggiungere un warning nel log quando `tenant_id is None`. Valutare di richiedere sempre `X-Tenant-Id` per endpoint dati in modalità superadmin.

---

### FINDING M-01
**Gravità:** MEDIUM | **Area:** Security / Quality
**Titolo:** `GET /logs/clear` usa metodo HTTP GET per operazione distruttiva

**File:** `backend/api/routes/logs.py:34-45`

Le richieste GET sono semanticamente idempotenti e sicure. Browser, CDN e proxy possono prefetchare URL GET. Usare GET per cancellare i log può causare la perdita accidentale dei log.

**Remediation:** Cambiare in `DELETE /logs`.

---

### FINDING M-02
**Gravità:** MEDIUM | **Area:** Stability
**Titolo:** `get_by_id` non filtra i ticket con soft-delete

**File:** `backend/repositories/ticket_repository.py:65-69`

```python
def get_by_id(self, db: Session, ticket_id: int, tenant_id: int | None = None):
    query = db.query(Ticket).filter(Ticket.id == ticket_id)
    # MANCA: .filter(Ticket.deleted_at.is_(None))
```

I ticket con stato "Eliminato" (soft-deleted) rimangono recuperabili via `GET /tickets/{id}`, `PATCH /tickets/{id}` e `PUT /tickets/{id}`. Un ticket eliminato può essere ri-modificato o ri-eliminato inconsistentemente.

**Remediation:** Aggiungere `.filter(Ticket.deleted_at.is_(None))` in `get_by_id`.

---

### FINDING M-03
**Gravità:** MEDIUM | **Area:** Security
**Titolo:** `POST /db/asset` disponibile a qualsiasi utente autenticato

**File:** `backend/api/routes/db_routes.py:87-99`

Endpoint diagnostico che crea asset senza alcun check sul ruolo. Un tecnico (ruolo minimo) può creare asset nel proprio tenant tramite questo endpoint non documentato.

**Remediation:** Aggiungere `_payload: dict = Depends(require_superadmin)` o rimuovere l'endpoint dal build di produzione.

---

### FINDING M-04
**Gravità:** MEDIUM | **Area:** Stability
**Titolo:** Creazione ticket a chunk non atomica — chunk orfani in caso di errore

**File:** `backend/repositories/ticket_repository.py:99-120`

La creazione di un ticket con durata > 8 ore genera più chunk collegati. Il campo `parent_ticket_id` non viene impostato sui chunk di continuazione. Se la creazione fallisce a metà, rimangono ticket parziali nel DB senza collegamento al padre.

**Remediation:** Impostare `parent_ticket_id` e `is_continuation=True` sui chunk. Wrappare il loop in un try/except con `db.rollback()`.

---

### FINDING M-05
**Gravità:** MEDIUM | **Area:** Privacy
**Titolo:** `AnonymizationService` non è mai usato — falsa garanzia di compliance AI

**File:** `backend/services/ai/anonymization_service.py`

Il servizio esiste, è strutturato correttamente, ma nessun flusso AI lo chiama. Chi legge il codice potrebbe pensare che l'anonimizzazione sia attiva. Non lo è. Il rischio concreto è documentato in C-04.

---

### FINDING M-06
**Gravità:** MEDIUM | **Area:** Quality
**Titolo:** `PRAGMA table_info` funziona solo su SQLite, non su PostgreSQL

**File:** `backend/api/routes/db_routes.py:43`

```python
result = conn.execute(text(f"PRAGMA table_info({name_clean})"))
```

`PRAGMA` è un comando SQLite. In produzione (PostgreSQL su Render), questa query restituisce un result vuoto senza errore, rendendo l'endpoint diagnostico `/db/schema/{table_name}` completamente inutile in produzione.

**Remediation:** Usare `information_schema.columns` per PostgreSQL:
```sql
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = :table_name
```

---

### FINDING M-07
**Gravità:** MEDIUM | **Area:** Stability
**Titolo:** Allegati email salvati in `frontend/public/uploads` — path inesistente in cloud

**File:** `backend/services/email_poller.py:23`

```python
UPLOAD_DIR = os.path.join(..., "frontend", "public", "uploads")
```

In deploy su Render, il frontend è deployato separatamente su Vercel. La directory `frontend/public/uploads` non esiste. Ogni allegato email genera un'eccezione silenziosa e il path salvato nel DB punta a una URL inesistente.

**Remediation:** Usare `storage.save_file()` (già implementato per gli allegati dei ticket) anche per gli allegati email.

---

### FINDING M-08
**Gravità:** MEDIUM | **Area:** Quality
**Titolo:** `/system-logs` restituisce oggetti ORM senza schema Pydantic

**File:** `backend/api/routes/logs.py:71`

```python
return {"total": total, "page": page, "logs": logs}  # logs = lista di oggetti SQLAlchemy
```

Senza `response_model`, FastAPI serializza l'intero oggetto ORM con tutti i campi, incluso `extra_info` che può contenere dati sensibili strutturati.

**Remediation:** Definire un `SystemLogOut` Pydantic schema e usarlo come `response_model`.

---

### FINDING M-09
**Gravità:** MEDIUM | **Area:** Quality / Integrity
**Titolo:** Versione backend (`1.9.8`) non allineata con frontend (`2.4.2`)

**File:** `backend/core/config.py:15-16`

```python
VERSION = "1.9.8"
BUILD_DATE = "2026-04-05"
```

Rende impossibile correlare versioni frontend/backend in produzione e crea confusione nei log di supporto.

**Remediation:** Aggiornare `VERSION` a `2.4.2` e allineare a ogni release.

---

### FINDING L-01
**Gravità:** LOW | **Area:** Quality
**Titolo:** `GET /logs` — parametro `lines` senza limite superiore

**File:** `backend/api/routes/logs.py:15`

```python
lines: int = Query(100)  # nessun le=
```

`?lines=1000000` legge l'intero file di log in memoria. Aggiungere `le=1000`.

---

### FINDING L-02
**Gravità:** LOW | **Area:** Quality
**Titolo:** Campi stringa nei Pydantic schema senza `max_length`

**File:** `backend/schemas/ticket.py`, `backend/schemas/schemas.py`

`titolo: str = Field(..., min_length=1)` senza `max_length`. Stringhe di lunghezza arbitraria accettate e salvate in DB.

**Remediation:** Aggiungere `max_length=500` su `titolo`, `max_length=5000` su `descrizione`.

---

### FINDING L-03
**Gravità:** LOW | **Area:** Quality
**Titolo:** Router montati sia senza prefisso che con `/v1` — superficie doppia

**File:** `backend/main.py:338-344`

Ogni endpoint principale è registrato due volte (`/tickets` e `/v1/tickets`). Nessun impatto funzionale immediato, ma raddoppia la superficie di attacco, complica l'audit dei log e aumenta il rischio di inconsistenze future tra le due versioni.

---

## 4. Isolamento multi-tenant

### Cosa funziona correttamente

- Ogni modello ORM ha `tenant_id` FK non nullable
- `get_current_tenant_id()` iniettato via `Depends` in tutti gli endpoint dati
- `check_tenant_ownership()` usato per verificare la proprietà di Asset e Tecnico
- Query ticket, asset, manuali, piani filtrano sempre per `tenant_id`
- Superadmin usa `X-Tenant-Id` header per cambiare contesto tenant

### Vulnerabilità di isolamento

**Superadmin senza header (FINDING H-08):** Dettagliato sopra. `tenant_id = None` → query globale.

**Log su filesystem condiviso (FINDING H-04):** Un `responsabile` può leggere log di tutti i tenant.

**`get_by_id` mancante di tenant su soft-delete (FINDING M-02):** Dettagliato sopra.

**`get_piano_manuale` — attività non filtrate per tenant:**

```python
# manuali.py
attivita = db.query(AttivitaManutenzione).filter(
    AttivitaManutenzione.manuale_id == manuale_id
    # MANCA: .filter(AttivitaManutenzione.tenant_id == tenant_id)
).all()
```

Il manuale è già verificato con `tenant_id`, ma le sue attività no. La probabilità di exploit è bassa (un manuale appartiene a un solo tenant), ma l'inconsistenza è un rischio latente.

**Email poller — tenant sospesi ricevono ancora email:**

`check_all_mailboxes()` recupera tutte le `EmailConfig` attive senza verificare `tenant.is_active`. Un tenant sospeso continua a generare ticket via email.

---

## 5. GDPR e Privacy

### Inventario dati personali

| Dato personale | Dove raccolto | Storage | Esposizione |
|---|---|---|---|
| Username | Form login | Tabella `utenti` | Superadmin, self |
| Password (bcrypt) | Form / reset | `utenti.password_hash` | Nessuno (hash) |
| Nome e cognome tecnico | Form tecnici | Tabella `tecnici` | Tenant |
| Password email IMAP | Config email | `email_config.password` (Fernet) | Responsabile |
| Indirizzo email mittente | Email in entrata | `ticket.descrizione` + `system_logs` | Tenant + OpenAI |
| Corpo email | Email in entrata | `ticket.descrizione` | Tenant + OpenAI |
| Firma digitale tecnico | Upload firma | Filesystem `uploads/` | Visualizzatori ticket |
| Date assenze tecnico | Form assenze | Tabella `tecnici_assenze` | Tenant |

### Verifica principi GDPR

| Principio (art.5) | Stato | Problema principale |
|---|---|---|
| Minimizzazione dati | ⚠️ PARZIALE | Corpo email completo salvato senza minimizzazione |
| Limitazione della finalità | ⚠️ PARZIALE | Dati operativi inviati a OpenAI senza base legale |
| Limitazione della conservazione | ❌ ASSENTE | Nessuna retention policy, soft-delete permanente |
| Integrità e riservatezza | ⚠️ PARZIALE | Chiavi hardcoded, JWT in localStorage |
| Privacy by design | ⚠️ PARZIALE | `AnonymizationService` presente ma non collegato |
| Privacy by default | ❌ ASSENTE | Default data collection massima, nessuna minimizzazione |

### Diritti dell'interessato

| Diritto GDPR | Implementato | Note |
|---|---|---|
| Accesso (art.15) | ❌ NO | Nessun endpoint "esporta i miei dati" |
| Rettifica (art.16) | ✅ Parziale | Solo tramite admin |
| Cancellazione (art.17) | ❌ NO | Soft delete: dati mai rimossi fisicamente |
| Limitazione (art.18) | ❌ NO | Non implementato |
| Portabilità (art.20) | ❌ NO | Export CSV esiste per tenant, non per persona fisica |

### Privacy nei log

- **`system_logs`:** il campo `extra_info` può contenere `sender` (email mittente del ticket da email), `ticket_id`, operazioni amministrative. Nessuna retention automatica.
- **File `maintai.log`:** log Python standard senza filtro tenant e senza retention automatica.
- **`created_by` nei ticket:** username salvato nell'audit trail — dato personale, ma giustificabile come legittimo interesse operativo.

---

## 6. Qualità e stabilità del codice

### Problemi di qualità rilevanti

**Doppia registrazione router:**
```python
# main.py: ogni endpoint montato due volte
app.include_router(tickets_router)          # /tickets
app.include_router(tickets_router, prefix="/v1")  # /v1/tickets
```
Nessun impatto funzionale, ma raddoppia la superficie, complica log e metriche.

**`ticket_repository.update()` — `planned_finish` ricalcolato anche su aggiornamenti di solo stato:**
```python
# Anche PATCH {stato: "In corso"} → ricalcola planned_finish
if ticket.planned_start and ticket.durata_stimata_ore:
    ticket.planned_finish = ticket.planned_start + timedelta(hours=float(ticket.durata_stimata_ore))
```
Un piano confermato con orari specifici può essere alterato involontariamente da un semplice cambio di stato.

**`config.py::init_backend()` chiama `Base.metadata.create_all()`** prima che i modelli siano importati → la create_all è inutile (Base ha 0 tabelle in quel momento). Quella in `init_db()` è l'unica effettiva.

**Filename con spazi ammessi in email allegati:**
```python
safe_filename = "".join([c for c in att.filename if c.isalpha() or c.isdigit() or c in ' .-_'])
```
Lo spazio è incluso nella whitelist: causa problemi su alcuni filesystem e server HTTP.

**`planned_start_time` come campo `TIME` su SQLite:** SQLite non ha tipo TIME nativo — viene trattato come stringa. Possibile inconsistenza con PostgreSQL in produzione.

### Stabilità operativa

**Email poller senza timeout per singolo messaggio:** Un'email con allegato molto grande blocca l'intero ciclo di polling per tutti i tenant attivi.

**Creazione chunk ticket non atomica:** Se la creazione di un chunk intermedio fallisce prima del commit, rimangono dati parziali. Il campo `parent_ticket_id` non è mai impostato (FINDING M-04).

**`_compute_scadenza` usa datetime naive senza timezone:** Possibili problemi di comparazione UTC vs locale nei piani multigiorno.

**Versione backend disallineata (FINDING M-09):** `config.py` riporta `1.9.8`, il frontend riporta `2.4.2`.

---

## 7. Quick wins

Correzioni ad alto impatto, basso costo — implementabili in meno di 2 ore complessivamente:

| # | Fix | File | Finding |
|---|---|---|---|
| QW-01 | Rimuovere `/db/reset-emergency` | `db_routes.py` | C-01 |
| QW-02 | Fail-fast se `JWT_SECRET` manca all'avvio | `security.py` | C-02 |
| QW-03 | Fail-fast se `ENCRYPTION_KEY` manca all'avvio | `security.py` | C-03 |
| QW-04 | `min_length=8` su `new_password` in tutti gli endpoint | `auth.py`, `tenants.py` | H-07 |
| QW-05 | `le=1000` sul parametro `lines` in `GET /logs` | `logs.py` | L-01 |
| QW-06 | `Ticket.deleted_at.is_(None)` in `get_by_id` | `ticket_repository.py` | M-02 |
| QW-07 | Cambiare `GET /logs/clear` in `DELETE /logs` | `logs.py` | M-01 |
| QW-08 | Aggiornare `VERSION` in `config.py` a `2.4.2` | `config.py` | M-09 |
| QW-09 | `require_superadmin` su `POST /db/asset` | `db_routes.py` | M-03 |
| QW-10 | Aggiungere `.filter(AttivitaManutenzione.tenant_id == tenant_id)` in `get_piano_manuale` | `manuali.py` | Isolamento |

---

## 8. Blocchi critici pre-rilascio

Questi 4 problemi devono essere risolti prima di qualsiasi rilascio con dati reali di clienti:

### BLOCKER 1 — C-01: Reset DB senza autenticazione
L'endpoint `/db/reset-emergency` permette a chiunque conosca un parametro query di distruggere l'intero database di produzione senza JWT, senza log, senza conferma.

### BLOCKER 2 — C-02 + C-03: Chiavi crittografiche hardcoded
Se `JWT_SECRET` e `ENCRYPTION_KEY` non sono impostate in Render (situazione possibile in ogni nuovo deploy o env reset), l'intera sicurezza del sistema collassa. Il JWT può essere forgiato. Le password IMAP possono essere decifrate.

### BLOCKER 3 — C-04: Dati personali inviati a OpenAI senza anonimizzazione
Titoli ticket, descrizioni, nomi tecnici e corpi di email vengono inviati all'API OpenAI (USA) senza alcuna anonimizzazione, potenzialmente in violazione del GDPR per i clienti europei.

### BLOCKER 4 — H-01: Nessun rate limiting sul login
Con password di default `admin/admin` presenti nel seed e nessun rate limiting sul login, un sistema di produzione è trivialmente compromettibile.

---

## 9. Piano di remediation

### Priorità 1 — CRITICAL (fare prima di qualsiasi deploy prod)

| Task | File | Ore stimate |
|---|---|---|
| Eliminare `/db/reset-emergency` | `db_routes.py` | 0.5h |
| Fail-fast se `JWT_SECRET` manca | `security.py` | 0.5h |
| Fail-fast se `ENCRYPTION_KEY` manca | `security.py` | 0.5h |
| Wiring `anonymizer` nel flusso AI planning | `ai_planner_service.py` | 3h |
| Rate limiting obbligatorio su `/auth/login` | `auth.py`, `requirements.txt` | 2h |
| Verificare `JWT_SECRET` e `ENCRYPTION_KEY` in Render | Render dashboard | 0.5h |

### Priorità 2 — HIGH

| Task | File | Ore stimate |
|---|---|---|
| Controllo `is_active` ad ogni richiesta autenticata | `security.py` o middleware | 3h |
| Rimuovere o filtrare per tenant endpoint `/logs` file system | `logs.py` | 1h |
| Aggiungere conferma a `POST /db/reset` | `db_routes.py` | 1h |
| Sanitizzazione HTML email body con bleach | `email_poller.py` | 1h |
| `min_length=8` su password in tutti gli endpoint | `auth.py`, `tenants.py` | 0.5h |
| Migrare JWT da localStorage a HttpOnly cookie | `auth.tsx`, `auth.py` | 8h |

### Priorità 3 — MEDIUM

| Task | File | Ore stimate |
|---|---|---|
| `deleted_at` filter in `get_by_id` | `ticket_repository.py` | 0.5h |
| `require_superadmin` su `POST /db/asset` | `db_routes.py` | 0.5h |
| Allegati email → usare `storage.save_file()` | `email_poller.py` | 2h |
| Fix `PRAGMA` → `information_schema` per PostgreSQL | `db_routes.py` | 1h |
| Filtro tenant su attività in `get_piano_manuale` | `manuali.py` | 0.5h |
| `max_length` su campi stringa in Pydantic schema | `schemas/ticket.py` | 1h |
| Validazione size e magic bytes su endpoint firma | `tickets.py` | 1h |
| `response_model` Pydantic per `/system-logs` | `logs.py` | 1h |

### Priorità 4 — LOW / GDPR

| Task | Ore stimate |
|---|---|
| Retention policy per `SystemLog` (es. 90 giorni) | 2h |
| Mascherare email mittente prima dello storage nel ticket | 1h |
| Aggiornare `VERSION` in `config.py` | 0.5h |
| Rimuovere doppio mount `/v1` o consolidare | 2h |
| Endpoint di cancellazione fisica dati per tenant (GDPR art.17) | 8h |

---

## 10. Patch plan

### PATCH-01: Fail-fast per chiavi crittografiche mancanti

**File:** `backend/core/security.py`

```python
# Sostituire il blocco con default fallback con:

SECRET_KEY = os.getenv("JWT_SECRET")
if not SECRET_KEY:
    raise RuntimeError(
        "FATAL: JWT_SECRET non impostata nelle variabili d'ambiente. "
        "Generare con: python -c \"import secrets; print(secrets.token_hex(32))\""
    )

ENCRYPTION_KEY_RAW = os.getenv("ENCRYPTION_KEY")
if not ENCRYPTION_KEY_RAW:
    raise RuntimeError(
        "FATAL: ENCRYPTION_KEY non impostata nelle variabili d'ambiente. "
        "Generare con: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
    )
ENCRYPTION_KEY = ENCRYPTION_KEY_RAW
```

**Test:** Avviare il server senza le env var → crash con messaggio chiaro. Con le env var → avvio normale.

---

### PATCH-02: Eliminare `/db/reset-emergency`

**File:** `backend/api/routes/db_routes.py`

Rimuovere completamente le righe 56-69. Il `POST /db/reset` (con JWT superadmin) è già sufficiente per emergenze controllate.

**Test:** `curl -X POST /db/reset-emergency?secret=anything` → HTTP 404.

---

### PATCH-03: Rate limiting obbligatorio su login

**File:** `backend/api/routes/auth.py`, `backend/requirements.txt`

```python
# requirements.txt: rendere slowapi obbligatorio (non condizionale)
# slowapi==0.1.9  # aggiungere come dipendenza diretta

# auth.py:
from backend.core.rate_limiter import limiter
from fastapi import Request

@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends(), ...):
    ...
```

**Test:** 6 tentativi di login in un minuto → HTTP 429 al sesto.

---

### PATCH-04: Anonimizzazione nel flusso AI planning

**File:** `backend/services/ai_planner_service.py`

```python
from backend.services.ai.anonymization_service import anonymizer

# In collect_planning_context(), prima di costruire il prompt:
tecnico_names = [t["nome"] for t in tecnicians_data]
workorders_anon = [
    anonymizer.anonymize_ticket_data(wo, sensitive_words=tecnico_names)
    for wo in workorders
]
# Usare workorders_anon nel prompt invece di workorders
```

**Test:** Verificare che il prompt inviato a OpenAI non contenga nomi reali o email.

---

### PATCH-05: `deleted_at` filter in `get_by_id`

**File:** `backend/repositories/ticket_repository.py`

```python
def get_by_id(self, db: Session, ticket_id: int, tenant_id: int | None = None):
    query = (
        db.query(Ticket)
        .options(joinedload(Ticket.asset))
        .filter(
            Ticket.id == ticket_id,
            Ticket.deleted_at.is_(None),  # ← aggiungere
        )
    )
    if tenant_id is not None:
        query = query.filter(Ticket.tenant_id == tenant_id)
    return query.first()
```

---

### PATCH-06: Sanitizzazione email e mascheramento mittente

**File:** `backend/services/email_poller.py`

```python
# requirements.txt: aggiungere bleach
import bleach, re

body_raw = msg.text or bleach.clean(msg.html or "", tags=[], strip=True) or "Nessun messaggio."
# Mascherare indirizzo mittente (PII)
sender_display = re.sub(r'[^@\s]+@[^@\s]+', '[EMAIL]', msg.from_)

descrizione = (
    "--- Ticket generato automaticamente da Email ---\n\n"
    f"Da: {sender_display}\n"
    f"Data: {date_str}\n\n"
    f"{body_raw}"
)
```

---

## 11. Piano di test di regressione

### Test manuali obbligatori post-fix

| # | Scenario | Risultato atteso |
|---|---|---|
| T-01 | Avviare il server senza `JWT_SECRET` impostata | Crash con errore leggibile, nessun avvio |
| T-02 | Avviare il server senza `ENCRYPTION_KEY` impostata | Crash con errore leggibile, nessun avvio |
| T-03 | `POST /db/reset-emergency?secret=qualsiasi` | HTTP 404 (endpoint rimosso) |
| T-04 | 6 tentativi di login falliti in un minuto | HTTP 429 al sesto tentativo |
| T-05 | Disabilitare un utente → usare il suo JWT su qualsiasi endpoint | HTTP 403 su ogni richiesta |
| T-06 | `GET /tickets/{id}` su ticket soft-deleted | HTTP 404 |
| T-07 | `GET /logs` come `responsabile` del tenant A | Solo log del tenant A |
| T-08 | `POST /db/asset` come `tecnico` | HTTP 403 |
| T-09 | Superadmin senza `X-Tenant-Id` su `GET /tickets` | Warning nel log server |
| T-10 | Upload allegato via email in ambiente cloud | File salvato in storage cloud, non in frontend/ |
| T-11 | Piano AI generato → controllare prompt OpenAI | Nessun nome reale, solo token anonimizzati |
| T-12 | `GET /tickets/{id}` con ticket di un altro tenant | HTTP 404 |
| T-13 | Password change con nuova password di 3 caratteri | HTTP 422 |
| T-14 | Import Excel bulk con `tenant_id` di un altro tenant | Solo quel tenant riceve i dati |
| T-15 | `GET /manuali/{id}/piano` — attività di un altro tenant | Solo attività del tenant corretto |

### Test automatici da aggiungere

```python
# backend/tests/test_security.py
def test_server_crash_without_jwt_secret():
    """Server non si avvia senza JWT_SECRET."""

def test_server_crash_without_encryption_key():
    """Server non si avvia senza ENCRYPTION_KEY."""

def test_login_rate_limit():
    """Sesto tentativo di login → HTTP 429."""

def test_cross_tenant_ticket_not_accessible():
    """Ticket di tenant B non accessibile da tenant A."""

def test_deleted_ticket_returns_404():
    """Ticket soft-deleted non trovato via get_by_id."""

def test_reset_emergency_endpoint_removed():
    """POST /db/reset-emergency → 404."""

# backend/tests/test_privacy.py
def test_ai_prompt_no_real_names():
    """Nessun nome tecnico reale nel prompt OpenAI."""

def test_email_html_stripped_in_description():
    """HTML non presente nella descrizione del ticket generato da email."""

def test_email_sender_masked():
    """Indirizzo email mittente non presente in chiaro nella descrizione."""

# backend/tests/test_tenant_isolation.py
def test_system_logs_filtered_by_tenant():
    """Responsabile vede solo log del proprio tenant."""

def test_assets_filtered_by_tenant():
    """Asset di un tenant non visibili a un altro."""

def test_tickets_filtered_by_tenant():
    """Ticket di un tenant non visibili a un altro."""

def test_piano_attivita_filtered_by_tenant():
    """Attività di un piano visibili solo al tenant corretto."""
```

---

*Documento generato da audit completo su codice reale — 2026-04-11*
*Prossima revisione raccomandata: dopo implementazione dei CRITICAL e HIGH blockers*
