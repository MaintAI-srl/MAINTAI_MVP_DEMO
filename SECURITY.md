# MaintAI — Security Policy

**Versione documento:** 1.0 — 2026-06-09
**Owner:** Security & Engineering MaintAI
**Contatto sicurezza:** security@maintai.io
**Vulnerability disclosure:** security@maintai.io (PGP su richiesta)

Questo documento è la policy formale di sicurezza delle informazioni di MaintAI.
Riferimenti operativi di dettaglio: [`docs/SECURITY_GUIDELINES.md`](docs/SECURITY_GUIDELINES.md),
[`docs/SECURITY_GUIDELINES_MAINTAI.md`](docs/SECURITY_GUIDELINES_MAINTAI.md),
[`docs/SECURITY_CHECKLIST.md`](docs/SECURITY_CHECKLIST.md).
Mapping di conformità: [`docs/security/ISO27001_CONTROLS_MAPPING.md`](docs/security/ISO27001_CONTROLS_MAPPING.md),
[`docs/security/NIS2_COMPLIANCE.md`](docs/security/NIS2_COMPLIANCE.md).

---

## 1. Scope e Framework di Riferimento

MaintAI è una piattaforma SaaS B2B (CMMS/EAM) per la manutenzione industriale.
Lo scope dell'ISMS copre: applicazione web (Next.js/Vercel), API backend
(FastAPI/Render), database (PostgreSQL/Supabase), object storage (Supabase),
integrazioni AI (OpenAI) ed Email-to-Ticket (IMAP).

Framework applicati:
- **ISO/IEC 27001:2022** — Information Security Management System.
- **ISO/IEC 27002:2022** — controlli (mapping completo in `docs/security/ISO27001_CONTROLS_MAPPING.md`).
- **Direttiva UE 2022/2555 (NIS2)** Art. 21 — misure di gestione del rischio (vedi `docs/security/NIS2_COMPLIANCE.md`).
- **GDPR Reg. 2016/679** — trattamento dati personali (§9).
- **OWASP Top 10 2021** — mitigazioni applicative.

---

## 2. Architettura di Sicurezza

```
                         HTTPS / TLS 1.2+
   ┌──────────────┐   (HSTS, CSP, headers)   ┌────────────────────┐
   │  Browser /   │ ───────────────────────▶ │  Next.js (Vercel)  │
   │  Tauri App   │   JWT in cookie HttpOnly  │  security headers   │
   └──────────────┘                           └─────────┬──────────┘
                                                         │  fetch + JWT
                                                         ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  FastAPI (Render)                                                 │
   │  ① CORS allowlist  ② anti-CSRF (Origin/Referer, fail-closed)     │
   │  ③ rate limiting (slowapi)  ④ security headers                   │
   │  ⑤ JWT decode + blacklist JTI + token_version + is_active        │
   │  ⑥ RBAC (require_roles / superadmin)                             │
   │  ⑦ tenant isolation (tenant_id + check_tenant_ownership)         │
   │  ⑧ Pydantic validation  ⑨ SQLAlchemy ORM (no raw SQL su input)  │
   └───────────────┬───────────────────────────────┬─────────────────┘
                   │ sslmode require               │ Fernet at-rest (IMAP)
                   ▼                                ▼
       ┌────────────────────┐            ┌────────────────────┐
       │ PostgreSQL/Supabase│            │ Supabase Storage    │
       │ (RLS, backup)      │            │ (allegati, manuali) │
       └────────────────────┘            └────────────────────┘
```

### Flusso di autenticazione
1. `POST /auth/login` (rate-limited): verifica username + bcrypt; controlla `is_active` di utente e tenant.
2. Emissione JWT `HS256` con `sub`, `ruolo`, `tenant_id`, `tv` (token_version), `jti`, `exp`.
3. Token consegnato come **cookie HttpOnly** (`Secure` in prod, `SameSite`) + nel body per i client nativi.
4. Ogni richiesta: estrazione token (cookie→Bearer), decode, check blacklist JTI, check `token_version`, check `is_active`.
5. `POST /auth/logout`: aggiunge il `jti` alla blacklist (`RevokedToken`) e cancella il cookie.
6. Cambio password: incrementa `token_version` → invalida istantaneamente **tutte** le sessioni.

### Isolamento multi-tenant
- Ogni tabella ha `tenant_id` (FK su `tenants`).
- `get_current_tenant_id` risolve il tenant dal JWT; `ContextVar current_tenant_id` lo propaga.
- `superadmin` può impersonare un tenant solo via header `X-Tenant-Id`.
- Le query filtrano per `tenant_id`; `check_tenant_ownership()` restituisce **404** su risorse di altri tenant (no information disclosure).

---

## 3. Gestione Accessi (ISO 27002 A.5.15–A.5.18)

**Ruoli applicativi** (campo JWT `ruolo`):
| Ruolo | Capacità |
|---|---|
| `superadmin` | gestione tenant, impersonificazione, accesso trasversale |
| `responsabile` (Manager/Planner) | gestione completa del proprio tenant |
| `tecnico` (Technician) | esecuzione, supporto AI, dati di propria competenza |
| (Viewer/API client) | sola lettura / accesso programmatico — da estendere |

- Autorizzazione enforced via `require_superadmin` / `require_roles(...)` e `check_tenant_ownership`.
- **Onboarding**: creazione utente con ruolo minimo necessario (least privilege) e password che rispetta la policy (§ sotto).
- **Offboarding**: `is_active=False` e/o bump `token_version` → revoca immediata di tutte le sessioni.
- **Revisione accessi**: trimestrale (review ruoli utenti per tenant).

**Password policy** (enforced in `backend/api/routes/auth.py` e `utenti.py`):
- Hashing **bcrypt** (cost di default della libreria, salt per-hash).
- Complessità: minuscole + maiuscole + numeri + simboli; lunghezza minima 8.
  *Raccomandazione enterprise/NIS2: portare il minimo a 12 caratteri (vedi backlog SEC-009).*
- Nessun hashing debole (MD5/SHA1/SHA256 plain) usato per le password.

---

## 4. Gestione Secrets e Credenziali (ISO 27002 A.8.13)

**Variabili d'ambiente richieste** (vedi `backend/.env.example`):
`DATABASE_URL` (con `sslmode=require` in prod), `JWT_SECRET` (≥32 byte, obbligatoria),
`ENCRYPTION_KEY` (chiave Fernet valida, obbligatoria), `OPENAI_API_KEY`,
`SUPABASE_URL` / `SUPABASE_SERVICE_KEY` / `SUPABASE_BUCKET`, `CORS_ORIGINS`,
`COOKIE_SECURE`, `ACCESS_TOKEN_EXPIRE_MINUTES`.

- `JWT_SECRET` ed `ENCRYPTION_KEY` sono **obbligatorie**: il backend non si avvia se mancano o sono malformate.
- **Mai committare**: `.env`, `.env.*`, `*.pem`, `*.key`, `tauri_signing_key.txt*`, credenziali. Garantito da `.gitignore`.
- **Procedura di rotazione (trimestrale o on-demand su compromissione sospetta):**
  1. Genera nuovo segreto (`python -c "import secrets; print(secrets.token_hex(32))"` per JWT; `Fernet.generate_key()` per encryption).
  2. Aggiorna la variabile sul provider (Render/Vercel).
  3. Per `JWT_SECRET`: la rotazione invalida tutti i token attivi (logout forzato globale — comportamento atteso).
  4. Per `ENCRYPTION_KEY`: ri-cifrare i dati at-rest esistenti prima della dismissione della vecchia chiave.
  5. Registra la rotazione nel log di sicurezza.

---

## 5. Logging e Monitoring (ISO 27002 A.8.15–A.8.16, NIS2 Art.21 §2e)

**Logging strutturato in DB** (`SystemLog`) tramite `log_to_db()/db_info/db_warn/db_error`,
con `timestamp`, `level`, `module`, `message`, `extra_info`, `tenant_id`. Il logging Python
standard è sempre aggiuntivo.

**Eventi tracciati** (obbligatori NIS2/ISO A.8.15):
- Login riuscito / fallito (con contesto).
- Logout (+ inserimento JTI in blacklist).
- Cambio/reset password.
- Anomalie CSRF (Origin/Referer mismatch o mancanti).
- Errori applicativi (handler centralizzato `AppError`/`generic_error_handler`).
- *Backlog:* arricchire con `ip_address`, `user_id`, `result` su tutte le operazioni CRUD critiche (Asset/WorkOrder/Plan/User) ed export dati (vedi SEC-007).

**Cosa NON loggare mai:** password (anche in chiaro temporaneo), token JWT completi,
chiavi API, contenuto integrale di PII sensibili.

**Retention:**
- Target policy: **minimo 12 mesi** per i log di sicurezza (NIS2 / ISO A.8.15).
- Stato attuale: il `retention_service` purga solo i ticket soft-deleted dopo 30 giorni.
  La retention/rotation formale dei `SystemLog` a 12 mesi è in backlog (SEC-007).
- Accesso ai log: solo ruoli amministrativi del tenant + superadmin, via `/admin/logs`.

**Intrusion detection (baseline / backlog):**
- I login falliti sono già loggati (`db_warn AUTH`).
- *Da implementare:* alerting su >10 login falliti/5min per utente e >50 risposte 401/403/min per IP.

---

## 6. Incident Response (ISO 27001 A.5.26, NIS2 Art. 23)

**Definizione di incidente:** qualsiasi evento che comprometta riservatezza, integrità o
disponibilità dei dati/servizi (es. accesso non autorizzato, data leak cross-tenant,
compromissione credenziali, indisponibilità prolungata, esfiltrazione).

**Procedura:**
1. **Rilevazione & triage** — da log/alert/segnalazione → classifica severity (Critica/Alta/Media/Bassa).
2. **Contenimento** — revoca sessioni (`token_version` bump / blacklist JTI), disabilita utenti compromessi (`is_active=False`), ruota i secret coinvolti, isola il componente.
3. **Eradicazione & ripristino** — rimuovi la causa, applica patch, ripristina da backup integro.
4. **Notifica (per clienti soggetti a NIS2):** il cliente (operatore essenziale/importante) è il
   responsabile della notifica all'autorità competente: **early warning entro 24h**, **notifica
   dettagliata entro 72h**, **report finale entro 1 mese**. MaintAI supporta con export log
   strutturato e timeline.
5. **Post-mortem** — root cause analysis, lezioni apprese, aggiornamento controlli.

**Contatti di emergenza:** security@maintai.io (canale primario).

---

## 7. Vulnerability Management (ISO 27002 A.8.8, NIS2 Art.21 §2h)

- **Dependency scanning mensile:** `pip-audit -r backend/requirements.txt` e `npm audit` (frontend); SAST con `bandit -r backend/ -ll`.
- **Triage:** CRITICAL/HIGH → fix immediato; MEDIUM → valutazione e fix se non breaking; LOW → backlog.
- **Penetration test:** annuale (esterno) + test mirati sui rilasci maggiori.
- **Responsible disclosure:** report a security@maintai.io; nessuna azione legale per ricerca in buona fede; riscontro entro 5 giorni lavorativi.
- Report storici: `docs/SECURITY_AUDIT_2026-05-30.md`, `docs/security/SECURITY_AUDIT_REPORT.md`.

---

## 8. Business Continuity (ISO 27001 A.5.29–A.5.30, NIS2 Art.21 §2c)

- **Backup:** Supabase esegue backup automatici gestiti (cifrati at-rest). Connessione DB con `sslmode=require`.
- **RPO target:** ≤ 24h. **RTO target:** ≤ 4h per incidenti critici.
- **Restore:** procedura di ripristino da snapshot Supabase; **test di restore trimestrale** (backlog operativo).
- **Resilienza:** il backend ritenta la connessione DB con backoff esponenziale all'avvio (no crash-loop sul pooler); i background job usano backoff.

---

## 9. GDPR Compliance

- **Dati personali trattati:** dati di contatto e professionali dei tecnici (nome, telefono, sede, assenze, attestati), credenziali utente (username + hash bcrypt), mittente/corpo delle email importate.
- **Base giuridica:** esecuzione del contratto con il cliente (titolare del trattamento); MaintAI agisce da **responsabile del trattamento**.
- **Retention dati personali:** per la durata del contratto + periodo legale; cancellazione su richiesta del titolare.
- **Diritti degli interessati:** accesso, rettifica, cancellazione, portabilità — gestiti tramite il titolare (cliente) con supporto MaintAI (export/delete).
- **Sub-processori (DPA):** Supabase (DB/storage), Vercel (hosting frontend), Render (hosting backend), OpenAI (elaborazione AI). DPA da mantenere agli atti; registro sub-processori disponibile ai clienti su richiesta.
- **Minimizzazione:** i payload inviati a OpenAI contengono solo i dati necessari alla diagnosi/parsing.

---

## 10. Contatti Sicurezza

- **Email sicurezza / disclosure:** security@maintai.io
- **Richieste GDPR / DPA:** privacy@maintai.io
- **SLA riscontro disclosure:** 5 giorni lavorativi.
