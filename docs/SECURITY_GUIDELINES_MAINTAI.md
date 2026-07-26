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

## 6. Dati inviati ai servizi AI esterni (OpenAI)

**Perché:** la guida base (§7.2, LLM06) chiede solo di "minimizzare i campi inviati". In un
SaaS multi-tenant industriale non basta: il prompt contiene anagrafiche di persone (GDPR) e
identità di impianto del cliente (segreto industriale). OpenAI è un sub-processore dichiarato
nel DPA, quindi ogni campo che esce va deciso, non subito.

**Regola d'oro: si tokenizza l'identificatore, mai la semantica tecnica.**

| Esce come token | Resta in chiaro |
|---|---|
| `Asset.nome`, `codice`, `matricola`, `numero_serie`, `posizione_fisica`, `fornitore` | `Asset.marca`, `modello`, `tipo`, `criticita`, `anno_installazione` |
| `Tecnico.nome`, `cognome`, telefono, indirizzo | competenze, ore giornaliere, orari, assenze |
| `Sito.nome`/ubicazione, `Impianto.nome`, `Tenant.nome` | area funzionale |
| email, telefoni, coordinate GPS | codici ricambio, misure, tolleranze, pressioni, parametri |

Mascherare marca e modello degraderebbe l'analisi guasti senza proteggere nulla: identificano
il costruttore, non il cliente. Mascherare i numeri tecnici svuota di senso il parsing dei
manuali. **Un'anonimizzazione troppo avida è un bug, non una misura di sicurezza.**

**Regole:**
- **Pseudonimi reversibili, non redazione.** Usare `backend/services/ai/pseudonymizer.py`
  (`Pseudonymizer`): token deterministici derivati dall'id ORM (`ASSET_3`, `TECNICO_7`), non
  `[SENSITIVE_DATA]`. La redazione distruttiva fa perdere al modello la coerenza referenziale
  fra anagrafica e testo libero, cioè peggiora il risultato mentre protegge meno.
- **Restore obbligatorio in uscita.** Ogni risposta AI va passata da `pseudo.restore()`
  **prima** di essere mostrata all'utente o persistita (`AiUsageLog.output_md`,
  `GeneratedPlan.plan_json`, `DiagnosticSession.root_cause`, ticket auto-generati).
- **Determinismo per le conversazioni multi-turno.** I token derivano dagli id: la sessione
  diagnostica ricostruisce la stessa mappa a ogni turno senza persisterla. Mai token casuali.
- **Masking al confine, non nei collector.** Dove i dati confluiscono in un unico messaggio
  (es. `agents_service.run_agent`) mascherare il messaggio composto: un collector aggiunto in
  futuro è coperto per costruzione.
- **Testo libero sempre incapsulato**: `wrap_untrusted()` + `UNTRUSTED_INPUT_POLICY` da
  `backend/services/ai/prompt_security.py` (difesa prompt injection, complementare al masking).
- **Immagini**: non pseudonimizzabili. Rimuovere i metadati EXIF/IPTC/XMP prima dell'invio
  (`asset_documenti._strip_image_metadata`) e loggare il trasferimento a terzi.
- **Nomi file utente**: non inviarli. Contengono cliente, commessa, sito (vedi
  `parse_manual_with_ai`, che invia solo l'estensione).
- **Log**: mai il prompt né i valori reali. Usare `pseudo.stats()`, che ritorna solo conteggi.

**Checklist:**
- [ ] Il nuovo call site AI costruisce un `Pseudonymizer` e maschera **tutto** il payload?
- [ ] La risposta passa da `restore()` prima di UI e persistenza?
- [ ] Marca/modello/misure/codici tecnici sono rimasti in chiaro?
- [ ] Testo libero avvolto in `wrap_untrusted()`?
- [ ] Il test `test_ai_pseudonymization.py` copre il nuovo call site (zero-leak)?

**Severità tipica:** Alta (LLM06 — disclosure a sub-processore), Critica se il payload
attraversa i confini di tenant.

---

*Addendum mantenuto insieme alla guida base. Aggiornare quando emergono nuovi pattern specifici di MaintAI.*
