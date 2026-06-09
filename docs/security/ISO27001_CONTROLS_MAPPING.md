# MaintAI — ISO/IEC 27001:2022 Controls Mapping

**Data:** 2026-06-09 · **Versione:** 1.0 · **Piattaforma:** MaintAI 3.3.1

Legenda stato: ✅ Implementato · 🔄 In corso / parziale · 📋 Pianificato/Nota · ❌ Non implementato

> Riferimenti di codice citati a scopo di evidenza (file reali del repository).

---

## Clausola 4 — Contesto dell'organizzazione
| Requisito | Implementazione MaintAI | Status |
|---|---|---|
| 4.1 Contesto esterno/interno | SaaS CMMS/EAM per industria (energia, logistica, acciaio) | ✅ Documentato |
| 4.2 Parti interessate | Clienti enterprise, tecnici, regolatori UE (NIS2/GDPR), fornitori cloud | ✅ Identificate |
| 4.3 Scope ISMS | Piattaforma MaintAI: web + API + DB + storage + integrazioni AI/IMAP | ✅ Definito (`SECURITY.md` §1) |

## Clausola 5–10 (ISMS)
| Requisito | Implementazione | Status |
|---|---|---|
| 5 Leadership / Policy | `SECURITY.md` come policy formale | ✅ |
| 6 Pianificazione / Risk assessment | `audit_preliminary.md` (asset, superfici, rischi) | 🔄 Risk register formale da estendere |
| 7 Supporto (competenze, awareness) | Documentazione tecnica (`CLAUDE.md`, guide `docs/`) | 🔄 |
| 8 Operatività (controlli) | Vedi Annex A | ✅ |
| 9 Valutazione prestazioni | Scan periodici (pip-audit/npm audit/bandit) | 🔄 KPI da formalizzare |
| 10 Miglioramento | Audit report + backlog SEC-xxx | ✅ |

---

## Annex A — Controls (ISO/IEC 27002:2022)

### A.5 — Organizational Controls
| Control | Titolo | Implementazione MaintAI | Status |
|---|---|---|---|
| A.5.1 | Policies for information security | `SECURITY.md`, `docs/SECURITY_GUIDELINES*.md` | ✅ |
| A.5.2 | InfoSec roles & responsibilities | RBAC: superadmin/responsabile/tecnico; owner sicurezza | ✅ |
| A.5.7 | Threat intelligence | Monitoraggio CVE (pip-audit/npm audit) | 🔄 |
| A.5.8 | InfoSec in project management | `CLAUDE.md` impone consulto guideline prima di ogni modifica | ✅ |
| A.5.9 | Inventory of information assets | `audit_preliminary.md` §1 | ✅ |
| A.5.10 | Acceptable use | ToS/contratti cliente | 🔄 |
| A.5.12 | Classification of information | PII tecnici, credenziali, dati operativi | 🔄 |
| A.5.14 | Information transfer | TLS 1.2+, HTTPS forzato, HSTS | ✅ |
| A.5.15 | Access control | JWT + RBAC + multi-tenant | ✅ (`core/security.py`) |
| A.5.16 | Identity management | Utente con username univoco, ruolo, tenant | ✅ |
| A.5.17 | Authentication information | bcrypt, policy password, `token_version`, blacklist JTI | ✅ |
| A.5.18 | Access rights (grant/review/revoke) | onboarding least-privilege, offboarding via `is_active`/`token_version` | ✅ / 🔄 review trimestrale |
| A.5.23 | InfoSec for cloud services | Supabase/Vercel/Render (SOC2/ISO presso fornitori) | ✅ |
| A.5.26 | Response to incidents | Incident Response `SECURITY.md` §6 | ✅ |
| A.5.28 | Collection of evidence | `SystemLog` persistente, export log | 🔄 |
| A.5.29 | InfoSec during disruption | Backoff startup DB, background job resilienti | 🔄 BCP da completare |
| A.5.30 | ICT readiness for BC | RPO/RTO definiti (`SECURITY.md` §8) | 🔄 test restore |
| A.5.34 | Privacy & PII | Sezione GDPR `SECURITY.md` §9 | ✅ |

### A.6 — People Controls
| Control | Titolo | Implementazione | Status |
|---|---|---|---|
| A.6.3 | Security awareness/training | Documentazione admin per clienti | 🔄 |
| A.6.7 | Remote working | Team remote-first; accesso via account dedicati | 📋 |
| A.6.8 | Security event reporting | `SystemLog` + canale security@maintai.io | ✅ |

### A.7 — Physical Controls
| Control | Titolo | Implementazione | Status |
|---|---|---|---|
| A.7.1 | Physical security perimeters | Delegato a Vercel/Render/Supabase (data center certificati) | ✅ (3rd party) |
| A.7.4 | Physical security monitoring | Delegato ai provider cloud | ✅ (3rd party) |

### A.8 — Technological Controls
| Control | Titolo | Implementazione | Status |
|---|---|---|---|
| A.8.1 | User endpoint devices | Web app + Tauri desktop; JWT in cookie HttpOnly | ✅ |
| A.8.2 | Privileged access rights | `superadmin`/`require_roles`, audit su azioni | ✅ |
| A.8.3 | Information access restriction | tenant isolation + `check_tenant_ownership` (404) | ✅ |
| A.8.4 | Access to source code | Repo privato GitHub, branch dedicati | ✅ |
| A.8.5 | Secure authentication | bcrypt, JWT, anti-CSRF, cookie HttpOnly/Secure | ✅ |
| A.8.5 (MFA) | Multi-factor authentication | Non ancora disponibile/forzato | 🔄 (SEC-006) |
| A.8.7 | Protection against malware | Dependency scan; upload con magic-bytes + MIME whitelist | ✅ |
| A.8.8 | Management of technical vulnerabilities | pip-audit/npm audit/bandit; fix pyjwt & next in questa sessione | ✅ / 🔄 cadenza mensile |
| A.8.9 | Configuration management | `.env.example`, config centralizzata, `render.yaml`/`vercel.json` | ✅ |
| A.8.10 | Information deletion | Soft delete + hard delete schedulato (`retention_service`) | 🔄 |
| A.8.12 | Data leakage prevention | No secret nel codice/log; serving file forzato `attachment` | ✅ |
| A.8.13 | Information backup | Backup gestiti Supabase (cifrati) | ✅ |
| A.8.15 | Logging | `SystemLog` strutturato; eventi auth/CSRF/errori | ✅ / 🔄 retention 12m |
| A.8.16 | Monitoring activities | Log + handler errori; IDS/alerting da formalizzare | 🔄 |
| A.8.20 | Networks security | CORS allowlist, security headers, TLS, anti-CSRF | ✅ |
| A.8.21 | Security of network services | HTTPS only, header sicuri lato API e frontend | ✅ |
| A.8.23 | Web filtering | CSP frontend (`next.config.ts`) | ✅ |
| A.8.24 | Use of cryptography | bcrypt, Fernet (at-rest IMAP), TLS 1.2+ | ✅ |
| A.8.25 | Secure development lifecycle | Code review, SAST (bandit), dependency scan, guideline obbligatorie | ✅ |
| A.8.26 | Application security requirements | Pydantic validation, OWASP mitigations | ✅ |
| A.8.27 | Secure system architecture | Layered (CORS→CSRF→rate limit→auth→RBAC→tenant→ORM) | ✅ |
| A.8.28 | Secure coding | SQLAlchemy ORM (no raw SQL su input), input validation, output encoding | ✅ |
| A.8.29 | Security testing | bandit/pip-audit/npm audit; pentest annuale | 🔄 |
| A.8.31 | Separation of environments | demo.db separato, prod/dev CORS split, `IS_PRODUCTION` gating | ✅ |

---

## Riepilogo copertura Annex A
| Categoria | ✅ | 🔄 | 📋 | Note |
|---|---|---|---|---|
| A.5 Organizational | 11 | 8 | 1 | gap principali: classificazione, BCP, training |
| A.6 People | 1 | 1 | 1 | training/awareness in corso |
| A.7 Physical | 2 | 0 | 0 | delegati a provider certificati |
| A.8 Technological | 18 | 6 | 0 | gap: MFA, retention log, IDS, deletion, pentest |

**Controlli tecnici core (A.8.3/A.8.5/A.8.20/A.8.24/A.8.28): tutti ✅.**
I gap residui sono prevalentemente organizzativi/operativi e tracciati come SEC-006…SEC-010 nel report di audit.
