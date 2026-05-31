# Security Checklist — Quick Reference

> Da consultare prima di ogni PR / deploy.
> Stack: Next.js (App Router) + Prisma + Auth.js + Vercel.
> Documento completo: vedi `SECURITY_GUIDELINES.md`.

---

## Severità

| Livello | Quando | SLA fix |
|---------|--------|---------|
| **Critica** | Compromissione tenant/privilegi/segreti/integrità | Immediato |
| **Alta** | Sfruttamento realistico, impatto importante CIA | 7 giorni |
| **Media** | Rischio significativo con prerequisiti | 30 giorni |
| **Bassa** | Hardening / hygiene | Prossimo ciclo |

---

## A01 — Access Control

- [ ] Ogni Route Handler mutante: `auth()` + `requireRole()`
- [ ] Ogni Server Action: `auth()` + `requireRole()` + Zod
- [ ] Query Prisma: `findFirst` con `tenantId`, mai `findUnique` su ID esterno
- [ ] Restituire `404` (non `403`) per risorse di altri tenant
- [ ] Middleware solo per redirect/header, MAI per authorization fine-grained
- [ ] Matrice ruolo → endpoint documentata

## A02 — Crypto

- [ ] Password con `bcrypt(cost ≥ 12)` o `argon2id`
- [ ] Env vars validate con Zod all'avvio
- [ ] Nessuna variabile sensibile con prefisso `NEXT_PUBLIC_`
- [ ] JWT con scadenza ≤ 60 min, algoritmo fisso (no `alg: none`)
- [ ] Dati at-rest sensibili: AES-256-GCM con chiave in env
- [ ] `.env*` in `.gitignore`

## A03 — Injection

- [ ] Niente `$queryRawUnsafe` / `$executeRawUnsafe`
- [ ] Ogni Route Handler valida body/query/params con Zod
- [ ] Ogni Server Action valida argomenti con Zod
- [ ] `dangerouslySetInnerHTML` solo dopo `DOMPurify.sanitize()`
- [ ] URL utente: validare protocollo prima di renderli in `href`
- [ ] Niente `exec()` con stringa concatenata — usare `execFile()`

## A04 — Insecure Design

- [ ] ID esposti = `cuid`/`uuid`, mai incrementali
- [ ] Token di sicurezza: ≥ 128 bit entropia (`crypto.randomBytes(32)`)
- [ ] Workflow critici con state machine esplicita
- [ ] Endpoint pubblici con rate limiting
- [ ] Backend rivalida sempre ciò che il frontend dichiara

## A05 — Misconfiguration

- [ ] Security headers in `next.config.js`:
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
  - `Content-Security-Policy` (testata)
- [ ] CORS allowlist esplicita, no wildcard in prod
- [ ] Error handling: no stack trace al client
- [ ] `ignoreBuildErrors: false`, `ignoreDuringBuilds: false`
- [ ] No default credentials

## A06 — Vulnerable Components

- [ ] `npm audit --omit=dev --audit-level=high` in CI (bloccante)
- [ ] Dependabot/Renovate attivo
- [ ] `package-lock.json` committato
- [ ] `npm ci` in CI (non `npm install`)
- [ ] Next.js all'ultima patch della minor
- [ ] Dipendenze critiche (auth, crypto) pinnate a versione esatta

## A07 — Authentication

- [ ] Login: rate limit per `(ip, email)`
- [ ] Risposte uniformi credenziali errate (no user enumeration)
- [ ] Reset password: messaggio uniforme indipendente da esistenza email
- [ ] Cookie sessione: `httpOnly`, `secure`, `sameSite=lax|strict`
- [ ] Fail-fast in prod se `secure=false`
- [ ] Password ≥ 12 char, check vs HIBP (k-anonymity)
- [ ] MFA disponibile (obbligatorio per admin)
- [ ] Logout invalida sessione (blacklist o `tokenVersion`)
- [ ] Access token ≤ 60 min, refresh token rotanti se serve

## A08 — Integrity

- [ ] Lockfile committato + `npm ci`
- [ ] Niente `eval()` / `new Function()` con input utente
- [ ] Webhook esterni: verifica firma HMAC
- [ ] Build artifacts firmati se distribuiti

## A09 — Logging

- [ ] Logger con redact (`pino` + `redact: ["password", "token", "authorization", "cookie"]`)
- [ ] Login/logout/cambio-password loggati
- [ ] No payload completi nei log
- [ ] No stack trace al client
- [ ] Audit trail immutabile per operazioni critiche
- [ ] Monitoring attivo (Sentry / Logtail / Datadog)

## A10 — SSRF

- [ ] Fetch su URL utente: validazione + blocco IP privati (10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, ::1, fe80::/10, fc00::/7)
- [ ] `redirect: "error"` o `"manual"` in fetch
- [ ] Allowlist domini se possibile

---

## API Security (OWASP API Top 10:2023)

- [ ] BOLA: `findFirst` con ownership
- [ ] Property-level auth: whitelist Zod dei campi modificabili (no mass assignment)
- [ ] Rate limit su tutti gli endpoint costosi
- [ ] Pagination con `limit` massimo (es. 100)
- [ ] Timeout esplicito su fetch esterne (`AbortSignal.timeout(5000)`)
- [ ] Validazione risposte API esterne con schema

---

## Next.js / Vercel

- [ ] `NEXT_PUBLIC_*` solo per valori che possono finire sul client
- [ ] Server Components: `select` esplicito Prisma quando passi a Client Components
- [ ] Server Actions: auth + RBAC + Zod sempre
- [ ] Middleware con matcher testato per casi edge
- [ ] Preview deployments protetti (Vercel Auth o basic auth)
- [ ] DB di staging separato da produzione per preview
- [ ] `vercel.json` redirect: no open redirect
- [ ] `next/image` `remotePatterns` con allowlist (no `domains: ["*"]`)
- [ ] Env vars separate Production / Preview / Development su Vercel

---

## AI/LLM (se presente)

- [ ] Output LLM validato con Zod schema
- [ ] Dati minimizzati nei prompt
- [ ] Rate limiting per utente/tenant
- [ ] Budget mensile con alert
- [ ] Function calling: ogni function ha auth + validazione
- [ ] Prompt/risposte AI completi NON loggati
- [ ] Documenti utente trattati come dati, non istruzioni

---

## File Upload (se presente)

- [ ] Magic bytes validation (`file-type`), non solo estensione
- [ ] Limite dimensione esplicito
- [ ] Storage privato (no bucket pubblici)
- [ ] Download via endpoint autenticato (verifica ownership)
- [ ] Signed URL con scadenza breve (5-15 min)
- [ ] Filename sanitizzato + nome interno random (`crypto.randomUUID()`)
- [ ] `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff`
- [ ] Antivirus per upload da utenti pubblici
- [ ] `.exe`, `.zip`, `.html` bloccati o sandboxati

---

## Secrets

- [ ] GitLeaks/TruffleHog in CI (bloccante)
- [ ] Pre-commit hook attivo
- [ ] `.gitignore` include: `.env*`, `.claude/`, `.cursor/`, `.idea/`, `*.db`, `*.sqlite`
- [ ] Procedura rotazione segreti documentata
- [ ] SBOM generato per ogni release
- [ ] Audit recente del repo per leak (anche history)

---

## CI/CD bloccante

- [ ] `npm run lint` (ESLint + plugin-security)
- [ ] `tsc --noEmit` (TypeScript strict)
- [ ] `npm audit --audit-level=high`
- [ ] `gitleaks protect --staged`
- [ ] Semgrep `--config=p/typescript --config=p/owasp-top-ten`
- [ ] CodeQL (GitHub Actions)
- [ ] Test RBAC/IDOR automatici

---

## Anti-pattern da evitare sempre

| ❌ Mai | ✅ Sempre |
|--------|----------|
| `findUnique({ where: { id } })` da input | `findFirst({ where: { id, tenantId } })` |
| `$queryRawUnsafe(...input...)` | `$queryRaw\`... ${input}\`` o API tipizzata |
| `dangerouslySetInnerHTML={{ __html: x }}` | `DOMPurify.sanitize(x)` prima |
| `NEXT_PUBLIC_*_SECRET=...` | Secret solo server-side |
| `ignoreBuildErrors: true` | `false`, fix the errors |
| `domains: ["*"]` in next/image | `remotePatterns` con allowlist |
| `Access-Control-Allow-Origin: *` con credentials | Allowlist + `credentials: true` |
| `logger.info({ body: req.body })` | Redact password/token/cookie |
| `Response.redirect(req.query.next)` | Validare path relativo |
| `fetch(userUrl)` | Validare dominio + blocco IP privati |
| Login senza rate limit | Rate limit per IP e per email |
| JWT lungo 7 giorni nel body | Access ≤ 60 min, refresh rotante |
| Validazione solo estensione file | Magic bytes + dimensione + sanitize |
| `eval(userInput)` / `new Function(userInput)` | Schema validation con Zod |

---

## Comandi utili

```bash
# Audit dipendenze
npm audit --omit=dev --audit-level=high

# Secret scan
gitleaks detect --source . --verbose

# Type check
npx tsc --noEmit

# Lint con plugin sicurezza
npm run lint

# Semgrep
semgrep --config=p/typescript --config=p/owasp-top-ten

# SBOM
npm sbom --sbom-format=cyclonedx > sbom.cdx.json

# Test rapido security headers (richiede curl)
curl -sI https://your-app.vercel.app | grep -iE "strict-transport|content-security|x-frame|x-content-type|referrer-policy"
```

---

**Fonti**: OWASP Top 10:2021, OWASP API Security Top 10:2023, OWASP ASVS v4.0.3, OWASP Top 10 for LLM Applications, CWE/SANS Top 25, Next.js/Vercel docs.
