# MaintAI — Audit di Sicurezza (Report Finale post-remediation)

**Data:** 2026-05-30
**Versione auditata:** backend `3.3.0` (`backend/core/config.py`)
**Metodologia:** [`docs/SECURITY_GUIDELINES.md`](SECURITY_GUIDELINES.md) + [`docs/SECURITY_CHECKLIST.md`](SECURITY_CHECKLIST.md) (OWASP Top 10:2021, OWASP API Security Top 10:2023, OWASP ASVS, OWASP Top 10 LLM)
**Scope:** backend FastAPI, frontend Next.js, isolamento multi-tenant, privacy/GDPR, configurazione cloud (Vercel/Render/Supabase), supply chain
**Stack reale:** FastAPI + SQLAlchemy + JWT (le linee guida sono Next.js/Prisma/Auth.js — principi OWASP identici, mappatura in `CLAUDE.md`).

> Questo è il **report finale** dopo due passaggi di audit e la remediation del 2026-05-30. Supera il precedente `docs/security.md` (v2.4.2), rimosso.

---

## 1. Executive Summary

Posture di sicurezza **buona e in netto miglioramento**. Dopo la remediation di oggi, **14 finding su 19 sono risolti nel codice** (suite test backend: **83/83 verde**). Restano:
- **1 critico parziale** — SEC-01: il segreto di produzione è stato rimosso dal tracking e protetto da `.gitignore` + CI di secret-scanning, **ma la rotazione della password e la riscrittura della history git restano azioni manuali dell'utente**.
- **2 aperti/deferiti** — SEC-04 (errori TS preesistenti che impediscono di attivare i controlli di build) e SEC-16 (versioni disallineate).
- **2 accettati con motivazione** — SEC-13 (masking nomi via NER) e SEC-15 (doppio mount `/v1`).

### Distribuzione finding

| Gravità | Tot | Risolti | Parziali | Aperti/Deferiti | Accettati |
|---|---|---|---|---|---|
| Critica | 1 | — | 1 (SEC-01) | — | — |
| Alta | 1 | 1 | — | — | — |
| Media | 9 | 8 | — | 1 (SEC-04) | — |
| Bassa | 8 | 5 | — | 1 (SEC-16) | 2 (SEC-13, SEC-15) |
| **Totale** | **19** | **14** | **1** | **2** | **2** |

### Aree verificate nel secondo passaggio (nessun problema)
`report.py` export Excel (filtra sempre `tenant_id`), `attestati.py` (CRUD con tenant filter, no upload), `email_config.py` (password IMAP cifrata Fernet + tenant scope), output AI (`diagnostic`/`manuals` usano `response_format` JSON/json_schema). Multi-tenant: pattern `get_current_tenant_id` + `check_tenant_ownership` applicato in modo consistente.

---

## 2. Tabella finale dei finding

| ID | Gravità | Titolo | Stato |
|---|---|---|---|
| SEC-01 | 🔴 Critica | Segreto DB di produzione nel repo (`.claude/settings.local.json`) | 🟡 Parziale |
| SEC-02 | 🟠 Alta | Stored XSS download documenti (content-type client, no nosniff) | ✅ Risolto |
| SEC-03 | 🟡 Media | Security header HTTP assenti (frontend + API) | ✅ Risolto |
| SEC-04 | 🟡 Media | `ignoreBuildErrors`/`ignoreDuringBuilds` = true | ⏳ Deferito |
| SEC-05 | 🟡 Media | CORS con localhost/IP privati anche in prod | ✅ Risolto |
| SEC-06 | 🟡 Media | Validità JWT 7 giorni | ✅ Risolto (24h) |
| SEC-07 | 🟡 Media | `COOKIE_SECURE` default false | ✅ Risolto |
| SEC-08 | 🟡 Media | Rate-limit AI parziale | ✅ Risolto |
| SEC-09 | 🟡 Media | Endpoint pubblico QR senza rate-limit/limiti input | ✅ Risolto |
| SEC-10 | 🟡 Media | `get_by_id` non filtra soft-deleted | ✅ Risolto |
| SEC-11 | 🟡 Media | `/system-logs` serializza ORM grezzo | ✅ Risolto |
| SEC-12 | 🟢 Bassa | `.env.example` disallineato dai nomi reali | ✅ Risolto |
| SEC-13 | 🟢 Bassa | Nomi nel corpo email non mascherati | ◻️ Accettato (serve NER) |
| SEC-14 | 🟢 Bassa | Nessuna validazione magic-bytes upload | ✅ Risolto |
| SEC-15 | 🟢 Bassa | Doppio mount router `/v1` | ◻️ Accettato (design) |
| SEC-16 | 🟢 Bassa | Versioni disallineate (3.3.0/3.1.7/3.2.0/3.2.1) | ⏳ Aperto |
| SEC-17 | 🟢 Bassa | `decrypt_data` fallback silenzioso | ✅ Risolto (log) |
| SEC-18 | 🟢 Bassa | Password creazione tenant senza complessità | ✅ Risolto |
| SEC-19 | 🟢 Bassa | Bulk import Excel senza limite dimensione | ✅ Risolto (10MB) |

---

## 3. Dettaglio interventi applicati (2026-05-30)

**SEC-02 (Alta)** — `backend/api/routes/asset_documenti.py` + nuovo `backend/core/file_validation.py`: in download il content-type è derivato da whitelist (il valore del client è ignorato), immagini `inline`/resto `attachment`, header `X-Content-Type-Options: nosniff`; in upload validazione magic-bytes.

**SEC-03 (Media)** — header di sicurezza su API (`backend/main.py`: middleware con nosniff, Referrer-Policy, Permissions-Policy, HSTS in prod) e frontend (`frontend/next.config.ts`: HSTS, X-Frame-Options: DENY, nosniff, Referrer/Permissions-Policy, CSP). Sul backend niente X-Frame-Options per non rompere l'eventuale preview di file in iframe.

**SEC-05 (Media)** — `backend/main.py`: in produzione gli origin localhost/IP privati non vengono aggiunti alla allowlist CORS; warning se presenti in `CORS_ORIGINS`. Rilevatore `IS_PRODUCTION` in `security.py` (ENV/RENDER/VERCEL/SUPABASE_URL).

**SEC-06 / SEC-07 (Media)** — `backend/core/security.py`: `ACCESS_TOKEN_EXPIRE_MINUTES` configurabile (default 24h, era 7gg); `COOKIE_SECURE` Secure-by-default in produzione.

**SEC-08 (Media)** — `@limiter.limit` aggiunto a diagnostic reply, guide chat, manuali upload, failure analyze (coerente con login/problem-analysis/planning già limitati).

**SEC-09 (Media)** — `backend/api/routes/check_primo_livello.py`: rate-limit su endpoint pubblici QR + `max_length` su `descrizione`/`operatore`.

**SEC-10 (Media)** — `backend/repositories/ticket_repository.py`: `get_by_id` esclude i soft-deleted; flag `include_deleted=True` usato solo da PATCH/PUT per il restore.

**SEC-11 (Media)** — `backend/api/routes/logs.py`: `/system-logs` con `response_model` Pydantic (`SystemLogOut`/`SystemLogsPage`).

**SEC-12 (Bassa)** — `backend/.env.example` allineato (`JWT_SECRET`, `ENCRYPTION_KEY`, `ACCESS_TOKEN_EXPIRE_MINUTES`, `COOKIE_SECURE`, `COOKIE_SAMESITE`).

**SEC-14 (Bassa)** — validazione magic-bytes su upload documenti e manuali (`backend/core/file_validation.py`).

**SEC-17 (Bassa)** — `decrypt_data` logga un warning sul fallback (no contenuti sensibili).

**SEC-18 (Bassa)** — `backend/api/routes/tenants.py`: `create_tenant` applica la stessa policy password complessa degli altri endpoint.

**SEC-19 (Bassa)** — `backend/api/routes/bulk_import.py`: limite 10MB sull'upload Excel (anti memory-exhaustion).

**Supply chain (SEC-01 root cause)** — nuovo `.github/workflows/security.yml`: secret-scan (gitleaks) + `pip-audit` (backend) + `npm audit --audit-level=high` (frontend).

---

## 4. SEC-01 — azioni manuali ancora richieste (CRITICO)

Fatto in automatico: `git rm --cached .claude/settings.local.json` + `.gitignore` aggiornato (mantiene `.claude/agents/` condivisi) + CI di secret-scanning.

**Da fare manualmente (il segreto è ancora nella history git — commit `eac6a84` e precedenti):**

1. **Ruotare la password Supabase** (dashboard → Database → reset password) e aggiornare `DATABASE_URL` su Render/Vercel. Valutare anche la rotazione di `JWT_SECRET` / `ENCRYPTION_KEY`.
2. **Riscrivere la history** (su un clone pulito, non in questo worktree):
   ```bash
   pip install git-filter-repo
   git clone https://github.com/alexMaster9982/MAINTAI_MVP_DEMO.git maintai-clean
   cd maintai-clean
   git filter-repo --path .claude/settings.local.json --invert-paths
   git push --force --all
   git push --force --tags
   ```
   In alternativa BFG: `bfg --delete-files settings.local.json`.
3. Considerare il segreto **compromesso** anche dopo la rimozione (la history può essere già stata clonata/indicizzata): la rotazione al punto 1 è la difesa reale.
4. Coordinare il force-push col team (tutti i cloni vanno ri-clonati).

---

## 5. SEC-04 — errori TS da correggere prima di attivare i controlli di build

I flag `ignoreBuildErrors`/`ignoreDuringBuilds` in `frontend/next.config.ts` restano `true`: girarli ora **rompe il build di produzione** (verificato con `tsc --noEmit`: 12 errori, tutti preesistenti). Lista:
- `app/planning/page.tsx`: *Duplicate function* (862, 944); `SetStateAction<TicketData[]>` mismatch (1127, 1129); proprietà mancanti su `EfficiencyBreakdown` (`rispetto_priorita`, `riduzione_spostamenti`, `matching_competenze`, 1269) e su `TicketData` (`sito_name`, `impianto_name`, 1640/1644).
- `next.config.ts`: TS2353 su `eslint` (cosmetico, non blocca `next build`).

→ Task dedicato consigliato (codice feature planning, rischio regressione). Dopo la correzione: impostare entrambi i flag a `false`.

---

## 6. Proposte di aggiunta ai criteri (da valutare)

Le linee guida sono ottime ma scritte per **Next.js/Prisma/Auth.js**. Per coprire bene MaintAI (FastAPI/SQLAlchemy/JWT, multi-tenant, job in background, endpoint pubblici) propongo 5 aggiunte (motivate). Da confermare se vuoi che le aggiunga come addendum `docs/SECURITY_GUIDELINES_MAINTAI.md`.

1. **Sezione "Isolamento multi-tenant" dedicata.** *Perché:* è il rischio #1 di un SaaS multi-tenant ma nelle guide è solo un sotto-caso di IDOR. Regole: ogni query filtra `tenant_id`; `check_tenant_ownership`→404; `X-Tenant-Id` solo per superadmin in route designate; attenzione esplicita al caso `tenant_id=None` (superadmin) che bypassa i filtri.
2. **Sicurezza dei background worker / job schedulati.** *Perché:* le guide assumono il ciclo request/response; MaintAI ha IMAP poller, retention e auto-ticket job non coperti. Regole: filtrare per tenant attivo, backoff sugli errori senza crash, no segreti nei log, limiti su dimensione email/allegati.
3. **Serving sicuro di file da backend applicativo (non CDN/Next).** *Perché:* il caso SEC-02 (FastAPI che serve file con content-type del client) non è coperto dalla §8 che assume storage/signed URL. Regola: content-type da whitelist, `nosniff`, `attachment` per non-immagini, magic-bytes.
4. **Endpoint pubblici non autenticati (token/QR).** *Perché:* MaintAI espone endpoint pubblici che creano dati (check primo livello via QR); le guide coprono il rate limiting ma non il pattern: token ad alta entropia (uuid4+), rate-limit, input con `max_length`, nessuna enumerazione/PII nelle risposte pubbliche.
5. **Adattamento Python/FastAPI dei controlli A03/A05/API.** *Perché:* servono gli equivalenti dei pattern TS: SQLAlchemy `text()` parametrizzato (mai f-string), validazione **Pydantic** con `Field(max_length/min_length)`, `Depends` per auth/RBAC, `response_model` per non esporre ORM, **slowapi** per il rate limiting.

---

## 7. Stato checklist di rilascio (sintesi finale)

| Sezione | Stato |
|---|---|
| A01 Access Control / multi-tenant | ✅ Buono |
| A02 Crypto (no secret hardcoded, bcrypt) | ⚠️ Codice ok — **SEC-01 history da scrubbare** |
| A03 Injection / XSS | ✅ Stored XSS upload risolto (SEC-02/14) |
| A04 Insecure Design (token, rate limit) | ✅ Rate-limit completato (SEC-08/09) |
| A05 Misconfiguration (header, CORS) | ✅ Header + CORS risolti; ⏳ build flags (SEC-04) |
| A06/A08 Dipendenze | ✅ Pinnate + CI audit aggiunta |
| A07 Authentication (revoca, cookie, durata) | ✅ Buono (SEC-06/07 risolti) |
| A09 Logging | ✅ Buono (SEC-11/17 risolti) |
| A10 SSRF | ✅ Fetch su host fissi |
| File Upload | ✅ Magic-bytes + serving sicuro |
| AI/LLM | ✅ PII anonimizzata, output JSON; rate-limit completo |
| Secrets | ⚠️ CI aggiunta; **SEC-01 rotazione+history pendenti** |

---

## 8. Cosa resta da fare (priorità)

1. **SEC-01** (Critico): ruotare password Supabase + scrub history (§4).
2. **SEC-04** (Media): correggere i 12 errori TS, poi attivare i controlli di build (§5).
3. **SEC-16** (Bassa): definire una sola fonte di verità per la versione.
4. Valutare le **aggiunte ai criteri** (§6).

---

*Report finale generato su codice reale — 2026-05-30. Suite test backend 83/83 verde. Riferimenti: `docs/SECURITY_GUIDELINES.md`, `docs/SECURITY_CHECKLIST.md`.*
