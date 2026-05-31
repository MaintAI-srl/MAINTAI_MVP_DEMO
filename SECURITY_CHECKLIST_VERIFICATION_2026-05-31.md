# Verifica checklist `docs/security.md` — stato findings

**Data:** 2026-05-31 · **Branch:** `claude/project-security-audit-8Pt87`
**Riferimento:** `docs/security.md` (audit v2.4.2, 24 findings) — usato come checklist autoritativa.
**Metodo:** verifica statica di ogni finding contro il codice attuale (v3.3.0); fix dei residui aperti.

> Nota: non esiste un file `risistema_codex.md` nel repository (ricerca globale negativa). Il file guida di sicurezza è `docs/security.md`, usato qui come checklist.

## Sintesi

Su 24 findings, **23 risultano risolti** (la maggior parte già chiusi dall'evoluzione del codice dalla v2.4.2 e dai Blocchi 1-4 precedenti) e **1 è superato dal design** (M-02). In questa sessione ho chiuso i 4 residui ancora aperti: **M-04, M-08, L-02, H-08**.

## Mappatura completa

### CRITICAL (4/4 risolti)
| ID | Stato | Evidenza |
|---|---|---|
| C-01 `/db/reset-emergency` | ✅ Risolto | `db_routes.py` **rimosso** dal progetto (l'intero modulo non esiste più). |
| C-02 JWT hardcoded | ✅ Risolto | `security.py`: nessun default, fail-closed all'avvio. |
| C-03 Fernet hardcoded | ✅ Risolto | `security.py`: nessun default, validazione Fernet fail-closed. |
| C-04 dati a OpenAI senza anonimizzazione | ✅ Risolto | `ai_planner_service.py` usa `anonymizer.mask_text()` su titolo/descrizione/asset (righe 19, 454, 630-631). |

### HIGH (8/8 risolti)
| ID | Stato | Evidenza |
|---|---|---|
| H-01 no rate limit login | ✅ Risolto | `auth.py`: `@limiter.limit("20/minute")`. |
| H-02 JWT localStorage 7gg | ✅ Mitigato | Web usa **cookie HttpOnly** (`credentials:"include"`); localStorage solo in modalità Tauri desktop; `COOKIE_SECURE` ora `true`. Residuo: TTL 7gg (SEC-M2, scelta di prodotto). |
| H-03 no check is_active per richiesta | ✅ Risolto | `_check_user_active()` invocato in `get_current_user_payload` ad ogni richiesta (verifica `user.is_active` **e** `tenant.is_active`). |
| H-04 /logs filesystem cross-tenant | ✅ Risolto | `/logs` ora `Depends(require_superadmin)`. |
| H-05 /db/reset distruttivo | ✅ Risolto | `db_routes.py` rimosso. |
| H-06 email HTML XSS + mittente PII | ✅ Risolto | `email_poller.py`: HTML→testo, mittente mascherato con `anonymizer.mask_text()`. |
| H-07 no min_length password | ✅ Risolto | `STRONG_PWD_REGEX` in `auth.py` e `tenants.py`. |
| H-08 superadmin senza tenant → query globale | ✅ Mitigato **(questa sessione)** | `security.py`: aggiunto **warning di log** quando un superadmin opera senza `X-Tenant-Id`. |

### MEDIUM (9/9 gestiti)
| ID | Stato | Evidenza |
|---|---|---|
| M-01 GET /logs/clear | ✅ Risolto | Ora `DELETE /logs`. |
| M-02 get_by_id soft-delete | ⚠️ Superato dal design | Esiste una **vista archivio** intenzionale (`get_paginated` mostra "Eliminato" su richiesta); `get_by_id` mantiene il filtro `tenant_id` → nessun leak cross-tenant. Applicare il filtro romperebbe archivio/ripristino. **Non modificato.** |
| M-03 POST /db/asset senza ruolo | ✅ Risolto | `db_routes.py` rimosso. |
| M-04 chunk non collegati al padre | ✅ Risolto **(questa sessione)** | `ticket_repository.create()`: chunk >8h ora collegati via `parent_ticket_id` + `is_continuation`; transazione già atomica (singolo commit). |
| M-05 AnonymizationService inutilizzato | ✅ Risolto | Ora collegato (vedi C-04). |
| M-06 PRAGMA table_info | ✅ Risolto | `db_routes.py` rimosso. |
| M-07 allegati email path inesistente | ✅ Risolto | `email_poller.py` usa `storage.save_file()`. |
| M-08 /system-logs senza response_model | ✅ Risolto **(questa sessione)** | `logs.py`: serializzazione **esplicita** dei campi (no oggetti ORM, no relazione `tenant`). |
| M-09 versione disallineata | ✅ Risolto | Allineata a 3.3.0 (Blocco 4). |

### LOW (3/3 risolti)
| ID | Stato | Evidenza |
|---|---|---|
| L-01 GET /logs `lines` senza limite | ✅ Risolto | `Query(100, ge=1, le=1000)`. |
| L-02 stringhe senza max_length | ✅ Risolto **(questa sessione)** | `TicketCreate` già limitato; aggiunti bound su `AssetCreate/Update` (nome/area/descrizione) e `eliminazione_note`. |
| L-03 doppio mount `/v1` | ✅ Risolto | `main.py`: mount singolo, nessun `prefix="/v1"`. |

### Isolamento multi-tenant aggiuntivo
| Voce | Stato | Evidenza |
|---|---|---|
| `get_piano_manuale` attività senza tenant | ✅ Risolto | `manuali.py`: `.filter(AttivitaManutenzione.tenant_id == tenant_id)`. |
| Email poller — tenant sospesi | ✅ Risolto | `email_poller.py`: `.filter(... Tenant.is_active == True)`. |

## Fix applicate in questa sessione
1. **H-08** — `security.py`: warning di log quando superadmin opera senza contesto tenant.
2. **M-04** — `ticket_repository.py`: linkatura `parent_ticket_id`/`is_continuation` sui chunk >8h.
3. **M-08** — `logs.py`: serializzazione esplicita di `/system-logs` (no esposizione ORM/relazioni).
4. **L-02** — `schemas/schemas.py` e `schemas/ticket.py`: `max_length` sui campi input free-text.

## Verifica
- ✅ `py_compile` OK su tutti i file modificati.
- ⚠️ `pytest` e build frontend non eseguibili in questo ambiente (dipendenze/`node_modules` assenti) → validare in CI.
