# MaintAI — Conformità Direttiva NIS2 (UE 2022/2555)

**Data:** 2026-06-09 · **Versione:** 1.0 · **Piattaforma:** MaintAI 3.3.1

Legenda: ✅ Implementato · 🔄 Parziale/in corso · 📋 Da implementare

---

## Applicabilità

MaintAI è un software SaaS per la gestione della manutenzione di infrastrutture
industriali. I clienti target (impianti energetici, logistica/aeroportuale,
siderurgia) possono qualificarsi come **soggetti essenziali o importanti** ai
sensi della NIS2 (Art. 3). In quanto fornitore ICT di tali soggetti, MaintAI
rientra nella **supply chain** soggetta agli obblighi di sicurezza che i clienti
devono propagare ai fornitori (Art. 21 §2 lett. d e §3).

Questo documento dichiara le misure tecniche e organizzative di MaintAI a supporto
della conformità NIS2 dei propri clienti.

---

## Art. 21 §2 — Misure di gestione dei rischi di cybersicurezza

### §2a — Policy di analisi dei rischi e sicurezza dei sistemi informativi
**✅ Implementato**
- Policy formale: `SECURITY.md`.
- Mapping controlli: `docs/security/ISO27001_CONTROLS_MAPPING.md`.
- Analisi asset/rischi: `docs/security/audit_preliminary.md`.
- Review annuale prevista.

### §2b — Gestione degli incidenti
**✅ Implementato**
- Procedura di Incident Response in `SECURITY.md` §6.
- Audit trail in `SystemLog` per ricostruzione timeline (login con indirizzo IP reale),
  con retention minima 12 mesi enforced dal `retention_service`.
- Rilevamento attivo: `security_monitor` genera alert persistenti su pattern di
  brute-force (≥10 login falliti/utente o ≥30/IP in 5 minuti); rate limit login 5/min per IP.
- Capacità di contenimento immediato: revoca sessioni (`token_version`, blacklist JTI), disabilitazione utenti (`is_active`).

### §2c — Continuità operativa e gestione delle crisi
**🔄 Parziale**
- Backup automatici Supabase (cifrati). RPO target ≤24h, RTO target ≤4h (`SECURITY.md` §8).
- Resilienza runtime: retry DB con backoff esponenziale all'avvio; background job con backoff.
- **Da completare:** procedura di restore documentata step-by-step e **test di restore trimestrale**.

### §2d — Sicurezza della supply chain
**✅ Implementato / 🔄 documentale**
- Dependency scanning periodico: `pip-audit`, `npm audit`, SAST `bandit`.
- Fornitori primari con certificazioni: Supabase (SOC 2 Type II), Vercel (SOC 2 Type II), Render (SOC 2), OpenAI (DPA disponibile).
- **Da mantenere agli atti:** DPA firmati e registro sub-processori (vedi `SECURITY.md` §9).

### §2e — Sicurezza in acquisizione, sviluppo e manutenzione
**✅ Implementato**
- Secure Development Lifecycle: code review, guideline obbligatorie (`CLAUDE.md` → `docs/SECURITY_GUIDELINES*`).
- SAST con `bandit`; gate TypeScript/ESLint nel build frontend.
- Mitigazioni OWASP Top 10 documentate.

### §2f — Politiche e procedure per valutare l'efficacia delle misure
**🔄 In corso**
- Scan periodici come misura di verifica.
- **Da definire come KPI:** MTTR incidenti, % vulnerabilità HIGH/CRITICAL patchate entro SLA, uptime, esito test restore. Review trimestrale.

### §2g — Igiene informatica di base e formazione
**🔄 / 📋**
- Documentazione tecnica e operativa esistente (`docs/`).
- **Da produrre:** checklist di onboarding sicuro per clienti enterprise e materiali di formazione per tecnici manutentori.

### §2h — Politiche sull'uso della crittografia
**✅ Implementato**
- TLS 1.2+ su tutti i canali (HTTPS forzato, HSTS in produzione).
- Password: bcrypt (salt per-hash), policy minima 12 caratteri con complessità completa.
- At-rest: Fernet per credenziali IMAP; `ENCRYPTION_KEY` obbligatoria e validata all'avvio.
- JWT `HS256` con `JWT_SECRET` obbligatoria (≥32 byte) ed `exp` configurato.
- Connessione DB con `sslmode=require`.

### §2i — Sicurezza HR, controllo accessi e gestione degli asset
**✅ Implementato**
- RBAC multi-ruolo + isolamento multi-tenant.
- Offboarding: revoca immediata sessioni (`is_active=False` / bump `token_version`).
- Inventario asset informativi (`audit_preliminary.md`).

### §2j — Autenticazione a più fattori (MFA) e comunicazioni sicure
**🔄 / 📋 (gap noto — SEC-006)**
- Comunicazioni: TLS + cookie HttpOnly/Secure/SameSite + anti-CSRF — ✅.
- **MFA:** non ancora disponibile/forzato. Backlog prioritario: TOTP obbligatorio per ruoli `superadmin` e `responsabile`, con procedura di recupero documentata.

---

## Art. 23 — Obblighi di segnalazione degli incidenti

La notifica all'autorità competente è responsabilità del **cliente** (soggetto NIS2).
MaintAI fornisce supporto:
- Export dei log dell'incidente in formato strutturato (`SystemLog`).
- Timestamp precisi (timezone-aware) per la ricostruzione della timeline.
- Canale dedicato `security@maintai.io`.

Tempistiche NIS2 da rispettare (a carico del cliente, con supporto MaintAI):
- **Early warning: entro 24h** dalla conoscenza dell'incidente significativo.
- **Notifica dettagliata: entro 72h**.
- **Report finale: entro 1 mese**.

---

## Registro Fornitori ICT (per clienti NIS2)

Disponibile ai clienti su richiesta:
- Elenco sub-processori con ruolo e paese di hosting.
- Certificazioni di sicurezza dei fornitori (SOC 2 / ISO 27001).
- Template DPA conforme GDPR/NIS2.

| Sub-processore | Ruolo | Certificazioni |
|---|---|---|
| Supabase | Database PostgreSQL + Storage | SOC 2 Type II |
| Vercel | Hosting frontend | SOC 2 Type II |
| Render | Hosting backend | SOC 2 |
| OpenAI | Elaborazione AI (diagnostica, parsing) | DPA disponibile |

---

## Sintesi conformità Art. 21 §2

| Misura | Stato |
|---|---|
| §2a Policy & risk | ✅ |
| §2b Incident management | ✅ |
| §2c Business continuity | 🔄 |
| §2d Supply chain | ✅ / 🔄 |
| §2e Secure development | ✅ |
| §2f Efficacia misure (KPI) | 🔄 |
| §2g Igiene & formazione | 🔄 |
| §2h Crittografia | ✅ |
| §2i HR / accessi / asset | ✅ |
| §2j MFA | 🔄 |

**5/10 pienamente implementate, 5/10 parziali** — i gap residui sono BCP (test restore),
KPI di efficacia, formazione e MFA. Nessun gap è bloccante a livello di controllo tecnico core.
