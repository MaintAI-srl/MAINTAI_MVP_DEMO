# MaintAI — Valutazione di vendibilità SaaS

**Data:** 2026-05-31 · **Branch:** `claude/project-security-audit-8Pt87`
**Base:** analisi diretta del codice (gli agenti di audit approfondito sono stati interrotti da un limite di sessione; questa valutazione è stata svolta manualmente con ricerche mirate sul repository).
**Premessa:** i Blocchi 1–4 dell'audit di sicurezza/stabilità sono stati applicati e pushati (commit `e755fad`, `f044a94`, `36d7917`). Questo documento valuta la maturità **come prodotto SaaS commerciale**, che è cosa diversa dalla qualità del codice.

---

## Verdetto in una riga

> **MaintAI NON è ancora vendibile come SaaS self-service a pagamento.** Il *prodotto applicativo* è solido e l'isolamento multi-tenant ora è robusto, ma mancano interi **pilastri di business** (pagamenti, registrazione autonoma, CI/CD, osservabilità, backup/DR documentato). È invece **adatto a un pilota controllato / early-access** con 1–3 clienti gestiti manualmente e onboarding assistito.

---

## Matrice dei pilastri SaaS

| # | Pilastro | Stato | Note |
|---|---|---|---|
| 1 | **Billing & Subscription** | ❌ Assente | Nessuna integrazione pagamenti (no Stripe/checkout/fatturazione/piani). Impossibile incassare in modo automatico. |
| 2 | **Onboarding self-service** | ❌ Assente | `auth.py` espone solo login/logout/me/change-password. Nessun signup pubblico. Tenant e utenti creati **solo** da `superadmin` (`tenants.py`). Onboarding 100% manuale. |
| 3 | **Multi-tenancy (isolamento)** | ✅ Buono | DB unico condiviso + `tenant_id` su ogni tabella, ORM event listener, e dopo i fix i leak noti sono chiusi. Adeguato per decine di tenant. |
| 4 | **Osservabilità & ops** | ⚠️ Parziale | `/health` ✅, `SystemLog` in DB ✅. Manca error-tracking (no Sentry/APM), metriche, alerting, uptime monitoring. |
| 5 | **Backup & DR** | ⚠️ Non documentato | `render.yaml` non definisce un servizio DB né policy di backup; ci si affida ai default del provider gestito (Render/Supabase). Nessun piano di restore testato. |
| 6 | **GDPR / Compliance** | ⚠️ Parziale | ✅ `AnonymizationService` maschera PII prima di OpenAI (ottimo per UE). ❌ Nessuna privacy policy, consenso, DPA, export dati o cancellazione (diritto all'oblio) self-service. |
| 7 | **CI/CD & qualità rilascio** | ❌ Assente | Nessuna pipeline `.github/workflows`. `render.yaml` ha `autoDeploy: true` su `main` **senza gate di test/lint** → ogni push va in produzione non testato. |
| 8 | **Scalabilità & performance** | ⚠️ Parziale | Cold start Render documentato (30-60s), nessun caching, N+1 noto in `emergency.py`, costi OpenAI non limitati per tenant. |
| 9 | **Sicurezza operativa** | ✅ Discreto | Rate limit su login (20/min) anti brute-force, revoca JWT, segreti fail-closed, role check (post-fix). Manca rotazione segreti e audit trail amministrativo strutturato. |
| 10 | **Documentazione cliente & supporto** | ⚠️ Interna | Buona doc tecnica interna (CLAUDE, AGENTS, ROADMAP_PMI). Nessuna doc utente finale, SLA, canale di supporto, changelog pubblico. |

**Punteggio sintetico:** 2 pilastri ✅ · 5 ⚠️ · 3 ❌ → **maturità SaaS ~40-50%**. La parte *applicativa* è matura; la parte *commerciale/operativa* no.

---

## Blocker assoluti prima di vendere (ordinati, con stima sforzo)

| # | Blocker | Perché blocca la vendita | Sforzo |
|---|---|---|---|
| 1 | **Registrazione & onboarding self-service** (signup, verifica email, creazione tenant+admin) | Senza, ogni cliente richiede lavoro manuale del superadmin: non scala, non è "SaaS". | **L** |
| 2 | **Billing/Subscription** (Stripe: piani, trial, fatture, limiti per piano) | Non puoi incassare né limitare l'uso. | **L** |
| 3 | **CI/CD con gate di test** (GitHub Actions: pytest + build + lint bloccanti prima del deploy) | `autoDeploy` su main senza test = rischio di mandare in produzione codice rotto verso clienti paganti. | **M** |
| 4 | **Backup/DR documentato e testato** (backup automatici PostgreSQL + procedura di restore) | Perdere dati di un cliente pagante è esistenziale. | **M** |
| 5 | **Error tracking & alerting** (Sentry + uptime monitor) | Senza, scopri i down dai clienti, non dai tuoi strumenti. | **S/M** |
| 6 | **GDPR completo** (privacy policy, DPA, export + cancellazione dati self-service, registro trattamenti) | Obbligo legale per vendere a PMI UE; l'anonimizzazione c'è ma non basta. | **M** |
| 7 | **Limiti di costo/uso AI per tenant** (quota chiamate OpenAI per piano) | Un tenant può far esplodere i costi OpenAI; va legato al billing. | **S/M** |
| 8 | **Verifica build/test verde** (i test non sono mai eseguiti in CI; build frontend non validata) | Stato di qualità reale ignoto senza esecuzione automatica. | **S** |

Legenda sforzo: **S** = giorni, **M** = 1-2 settimane, **L** = settimane/mese.

---

## Cosa è già pronto (non sottovalutarlo)

- Applicazione funzionalmente ricca: siti/asset, ticket, planner AI (deterministico + GPT), diagnostica, manuali PDF, dashboard, kanban, email-to-ticket, QR check.
- **Isolamento multi-tenant ora robusto** (post-fix): la base tecnica per il multi-cliente c'è.
- Igiene di sicurezza di base sopra la media per un MVP: segreti fail-closed, dipendenze pinnate, anti-brute-force, anonimizzazione PII verso l'AI, rate limiting.

---

## Raccomandazione di percorso

1. **Ora → Pilota assistito** (early access, 1–3 clienti, contratto diretto, onboarding manuale, fatturazione fuori-piattaforma). Tecnicamente fattibile **subito** dopo aver chiuso i blocker #3, #4, #5 (CI, backup, monitoring) — sforzo ~2-3 settimane.
2. **Poi → SaaS self-service** quando sono chiusi #1, #2, #6, #7 (onboarding, billing, GDPR, quote AI) — sforzo ~1-2 mesi.

---

> Nota: i test automatici (`pytest`) e la build frontend non sono eseguibili nell'ambiente di audit (dipendenze/`node_modules` non installati). Lo stato "verde" va confermato in una pipeline CI, che è essa stessa uno dei blocker.
