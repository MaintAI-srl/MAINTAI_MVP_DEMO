# Security Guidelines — Addendum specifico MaintAI

> **Complemento progetto-specifico** di [`SECURITY_GUIDELINES.md`](SECURITY_GUIDELINES.md) e [`SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md).
> Le linee guida base sono scritte per **Next.js + Prisma + Auth.js**; MaintAI usa **FastAPI + SQLAlchemy + JWT**, è **multi-tenant**, ha **job in background** ed espone **endpoint pubblici via QR**. Questo documento aggiunge i criteri che la guida base non copre o copre solo genericamente.
> Versione: 1.0 — 2026-05-30. Scala di severità: come nella guida base (Critica/Alta/Media/Bassa).

---

## Indice

1. [Isolamento multi-tenant](#1-isolamento-multi-tenant)
2. [Sicurezza dei background worker / job schedulati](#2-sicurezza-dei-background-worker--job-schedulati)
3. [Serving sicuro di file dal backend applicativo](#3-serving-sicuro-di-file-dal-backend-applicativo)
4. [Endpoint pubblici non autenticati (token / QR)](#4-endpoint-pubblici-non-autenticati-token--qr)
5. [Adattamento Python / FastAPI dei controlli OWASP](#5-adattamento-python--fastapi-dei-controlli-owasp)
6. [Conformità ISO 27001/27002 e NIS2](#6-conformità-iso-2700127002-e-nis2)

---

## 1. Isolamento multi-tenant

**Perché una sezione dedicata:** MaintAI è un SaaS multi-tenant; un leak cross-tenant è il rischio **#1** del prodotto. La guida base lo tratta solo come sotto-caso di IDOR (A01/API01). Qui i criteri sono espliciti e obbligatori.

**Regole:**
- Ogni tabella ha `tenant_id`. **Ogni query** su dati tenant-scoped DEVE filtrare per `tenant_id`.
- Per accessi per-id usare `check_tenant_ownership(db, Model, id, tenant_id)` (in `backend/core/security.py`): restituisce **404** (non 403) per non rivelare l'esistenza di risorse altrui.
- Il `tenant_id` si ottiene **solo** da `Depends(get_current_tenant_id)` — mai dal body/query del client.
- Superadmin: il context tenant arriva da header `X-Tenant-Id` ed è onorato **solo** se `ruolo == "superadmin"`. Usarlo solo in route esplicitamente amministrative.
- **Caso `tenant_id is None`** (superadmin senza header): le query saltano il filtro → possibile dump globale. Per gli endpoint dati: ritornare lista vuota o richiedere il contesto (vedi `utenti.py::list_utenti`). Mai lasciare che un endpoint dati restituisca silenziosamente tutti i tenant.
- Niente JOIN/subquery che attraversino i confini di tenant.

```python
# ❌ VULNERABILE — nessun filtro tenant, IDOR cross-tenant
ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()

# ✅ SICURO — filtro tenant esplicito (404 se non del tenant)
ticket = db.query(Ticket).filter(
    Ticket.id == ticket_id, Ticket.tenant_id == tenant_id
).first()
if not ticket:
    raise HTTPException(404, "Non trovato")
```

**Checklist:**
- [ ] Ogni nuovo endpoint dati ha `Depends(get_current_tenant_id)`?
- [ ] Ogni query ORM filtra `tenant_id` (o usa `check_tenant_ownership`)?
- [ ] Il caso superadmin `tenant_id=None` è gestito (no dump globale involontario)?
- [ ] Le risorse di altri tenant rispondono 404, non 403?

**Severità tipica:** Critica/Alta.

---

## 2. Sicurezza dei background worker / job schedulati

**Perché:** la guida base assume il ciclo request/response. MaintAI ha task in background avviati nel `lifespan` (`backend/main.py`): IMAP **email poller**, **retention job**, **auto-ticket job**. Hanno una superficie di rischio propria.

**Regole:**
- **Filtro tenant attivo:** i job che iterano su tutti i tenant devono escludere i tenant sospesi (`Tenant.is_active == True`). Vedi `email_poller.check_all_mailboxes`.
- **Resilienza:** mai far crashare il loop per un singolo elemento. Usare try/except per-item + backoff esponenziale sugli errori ripetuti (vedi `email_poller_task`). Un tenant problematico non deve bloccare gli altri.
- **Limiti di risorse:** dimensione massima di email/allegati (`MAX_EMAIL_ATTACHMENT_BYTES`), timeout su connessioni esterne (IMAP/HTTP).
- **Segreti & PII:** le credenziali (es. password IMAP) si salvano cifrate (Fernet, `encrypt_data`); nei log dei job mascherare mittente/PII (`anonymizer.mask_text`).
- **Idempotenza:** prevenire la creazione di record duplicati (es. email già processate → `mark_seen`).

**Checklist:**
- [ ] Il job filtra per tenant attivo?
- [ ] Un errore su un item non interrompe l'intero ciclo (try/except + backoff)?
- [ ] Limiti espliciti su dimensioni/tempi?
- [ ] Nessun segreto/PII in chiaro nei log del job?

**Severità tipica:** Media/Alta (privacy).

---

## 3. Serving sicuro di file dal backend applicativo

**Perché:** la §8 della guida base assume upload verso storage/CDN con signed URL. MaintAI serve alcuni file **direttamente dal backend FastAPI** (es. `asset_documenti` da `BYTEA` in DB). Servire un file con il `content_type` fornito dal client abilita **stored XSS** (un .png con `Content-Type: text/html`).

**Regole:**
- In **download**: derivare il content-type da una **whitelist sull'estensione** (ignorare quello del client); servire le immagini `inline` e **tutto il resto come `attachment`**; impostare sempre `X-Content-Type-Options: nosniff`. Usare `backend/core/file_validation.py::safe_serving`.
- In **upload**: validare i **magic bytes** (`validate_magic`), non solo l'estensione; limite di dimensione esplicito; sanitizzare il filename per l'header `Content-Disposition`.

```python
# ✅ download sicuro
media_type, disposition = safe_serving(doc.filename, doc.content_type)
headers = {
    "Content-Disposition": f'{disposition}; filename="{sanitize_filename_header(doc.filename)}"',
    "X-Content-Type-Options": "nosniff",
}
return Response(content=doc.file_data, media_type=media_type, headers=headers)
```

**Checklist:**
- [ ] Il content-type servito viene da whitelist, non dal client?
- [ ] `nosniff` presente e non-immagini forzate a `attachment`?
- [ ] Upload validato coi magic bytes + limite dimensione?

**Severità tipica:** Alta (stored XSS).

---

## 4. Endpoint pubblici non autenticati (token / QR)

**Perché:** MaintAI espone endpoint **pubblici** per gli operatori di produzione via QR (`check_primo_livello`: `/check/public/{token}` e `/segnala`) che **creano dati**. Pattern non coperto dalla guida base.

**Regole:**
- **Token ad alta entropia:** `uuid.uuid4()` o `secrets.token_urlsafe(32)`; mai id sequenziali.
- **Rate limiting obbligatorio** (slowapi) anche in lettura, per prevenire enumerazione/abuso.
- **Input bounded:** ogni campo del body con `Field(max_length=...)`; obbligatori validati.
- **Minimizzazione output:** le risposte pubbliche non devono esporre `tenant_id`, PII o dati di altri asset oltre il necessario.
- **Audit:** loggare l'origine (token troncato, non intero) delle azioni pubbliche.

**Checklist:**
- [ ] Token non indovinabile (≥128 bit)?
- [ ] Rate-limit sugli endpoint pubblici (lettura e scrittura)?
- [ ] `max_length` su tutti i campi del body pubblico?
- [ ] Nessuna PII/segreto nelle risposte pubbliche?

**Severità tipica:** Media (abuso flussi business / API06).

---

## 5. Adattamento Python / FastAPI dei controlli OWASP

**Perché:** i pattern della guida base (Zod, Prisma, Auth.js, Upstash) vanno tradotti nello stack reale.

| Controllo (guida base) | Equivalente MaintAI |
|---|---|
| Validazione Zod | **Pydantic** in `backend/schemas/` con `Field(min_length/max_length/pattern)` |
| Prisma `findFirst({id, tenantId})` | SQLAlchemy `.filter(Model.tenant_id == tenant_id)` + `check_tenant_ownership` |
| Auth.js `auth()` / `requireRole` | `Depends(get_current_user_payload)` / `require_superadmin` / check `payload["ruolo"]` |
| Rate limit `@upstash/ratelimit` | `slowapi` (`@limiter.limit("N/minute")`, richiede `request: Request` nel signature) |
| Prisma `$queryRawUnsafe` | SQLAlchemy `text()` **solo** con bind params, mai f-string |
| Prisma `select` (no over-fetch) | `response_model` Pydantic sugli endpoint FastAPI (mai restituire oggetti ORM grezzi) |
| Env validate (zod) all'avvio | fail-fast in `config.py`/`security.py` (es. `JWT_SECRET`, `ENCRYPTION_KEY` obbligatorie) |

```python
# ❌ SQL injection
db.execute(text(f"SELECT * FROM ticket WHERE titolo = '{q}'"))
# ✅ parametrizzato
db.execute(text("SELECT * FROM ticket WHERE titolo = :q"), {"q": q})
```

**Checklist:**
- [ ] Ogni body/query/param validato con Pydantic (limiti inclusi)?
- [ ] Nessun `text()` con f-string/concatenazione di input utente?
- [ ] Endpoint con `response_model` (no ORM grezzo)?
- [ ] Endpoint costosi/AI con `@limiter.limit`?
- [ ] Nuove env sensibili validate/fail-fast all'avvio?

**Severità tipica:** Critica/Alta (injection, over-exposure).

---

## 6. Conformità ISO 27001/27002 e NIS2

**Perché:** MaintAI è venduto a clienti dei settori manifatturiero/energetico/portuale che possono ricadere
nell'ambito della **Direttiva NIS2** (UE 2022/2555, recepita in Italia dal D.lgs. 138/2024) e che richiedono ai
fornitori ICT evidenze di conformità **ISO/IEC 27001:2022** / **27002:2022**. Ogni modifica che tocca sicurezza
deve preservare i controlli mappati nel documento dedicato.

> **Riferimento completo:** [`COMPLIANCE_ISO27001_27002_NIS2.md`](COMPLIANCE_ISO27001_27002_NIS2.md) —
> mappatura dei 93 controlli Annex A:2022, requisiti ISMS (clausole 4–10) e misure minime NIS2 Art. 21/23.

**Regole operative (da rispettare in ogni PR rilevante per la sicurezza):**

- **Tracciabilità del controllo:** quando aggiungi/modifichi una misura di sicurezza, annota nel commit o nella PR
  il controllo Annex A o la misura NIS2 corrispondente (es. *"A.8.5 / NIS2 21.j: MFA"*). Mantiene aggiornato lo SoA.
- **Crittografia (A.8.24 / NIS2 21.h):** dati sensibili at-rest sempre cifrati (Fernet `encrypt_data`), segreti solo
  in env con fail-fast, mai chiavi/hardcoded. TLS obbligatorio in transito (HSTS in prod).
- **Controllo accessi (A.8.2/8.3/8.5 / NIS2 21.i):** ogni endpoint con `Depends` auth+RBAC e filtro `tenant_id`;
  privilegi `superadmin` minimizzati; revoca immediata via `RevokedToken`/`token_version`.
- **Logging & audit trail (A.8.15 / A.5.28):** ogni operazione critica (login/logout, cambio password, conferma
  piano, modifiche RBAC/tenant) deve lasciare traccia in `SystemLog` con tenant/utente/azione/esito/timestamp UTC.
  È l'evidenza per la **notifica incidenti NIS2 (Art. 23: 24h/72h/1 mese)**.
- **Vulnerability handling (A.8.8 / NIS2 21.e):** dipendenze pinnate, CI `pip-audit`/`npm audit` bloccante,
  disclosure secondo [`SECURITY.md`](../SECURITY.md).
- **Gestione incidenti (A.5.24–5.26 / NIS2 Art. 23):** seguire il runbook
  [`INCIDENT_RESPONSE.md`](INCIDENT_RESPONSE.md). Non chiudere un incidente senza root-cause e azione correttiva.
- **MFA (A.8.5 / NIS2 21.j):** gap noto a priorità Alta — l'autenticazione a più fattori va prevista per gli account
  amministrativi prima della vendita a soggetti NIS2.

**Checklist conformità (rapida):**
- [ ] La modifica preserva l'isolamento multi-tenant e il filtro `tenant_id`? (A.8.3)
- [ ] Segreti/credenziali cifrati e mai nel codice/log? (A.8.24)
- [ ] L'operazione critica genera audit trail in `SystemLog`? (A.8.15)
- [ ] Le dipendenze nuove sono pinnate e passano l'audit CI? (A.8.8)
- [ ] Se introduce un nuovo flusso di autenticazione/accesso: è compatibile con MFA e RBAC? (A.8.5)
- [ ] Il controllo Annex A / NIS2 toccato è annotato nella PR?

**Severità tipica:** Alta (la non conformità può bloccare la vendita a clienti regolati NIS2).

---

*Addendum mantenuto insieme alla guida base. Aggiornare quando emergono nuovi pattern specifici di MaintAI.*
