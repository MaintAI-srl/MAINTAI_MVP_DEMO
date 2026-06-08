# MaintAI — Incident Response Runbook

> Procedura di gestione degli incidenti di sicurezza.
> Versione 1.0 — 2026-06-08. Copre: **ISO/IEC 27001:2022 A.5.24–5.26** (gestione incidenti),
> **A.5.28** (raccolta evidenze), **Direttiva (UE) 2022/2555 (NIS2) Art. 23** (notifica incidenti).

---

## 1. Scopo

Garantire rilevazione, classificazione, contenimento, eradicazione e ripristino tempestivi degli incidenti
di sicurezza, e supportare gli **obblighi di notifica NIS2** dei clienti regolati lungo la catena di fornitura.

## 2. Definizioni e classificazione di severità

Un **incidente** è un evento che compromette (o minaccia) Confidenzialità, Integrità o Disponibilità dei dati
o dei servizi MaintAI.

| Severità | Criterio | Esempi |
|---|---|---|
| 🔴 **Critica** | Compromissione dati cross-tenant, leak segreti di produzione, RCE, indisponibilità totale | Bypass isolamento tenant, esfiltrazione DB, chiave JWT compromessa |
| 🟠 **Alta** | Accesso non autorizzato limitato, stored XSS, escalation privilegi | XSS su documenti, bypass RBAC parziale |
| 🟡 **Media** | Sfruttamento con prerequisiti, DoS parziale | Brute-force non rate-limitato, IDOR a basso impatto |
| 🟢 **Bassa** | Hardening / nessun impatto diretto | Header mancante, info disclosure minore |

Un incidente è **"significativo" ai sensi NIS2** se causa grave disservizio operativo o perdita finanziaria,
o impatta altri soggetti con danni materiali/immateriali considerevoli → fa scattare la notifica (§5).

## 3. Ruoli

| Ruolo | Responsabilità |
|---|---|
| **Incident Lead** | Coordina la risposta, decide la classificazione e l'escalation |
| **Tech Responder** | Contenimento tecnico, analisi forense, fix |
| **Comms/Legal** | Notifiche a clienti e autorità (CSIRT), comunicazione |
| **Management** | Approvazione decisioni critiche (NIS2 Art. 20 — responsabilità degli organi di gestione) |

## 4. Fasi della risposta (NIST/ISO)

### 4.1 Rilevazione
Fonti: `SystemLog` (`/admin/logs`), alert CI/secret-scan, log Render/Vercel/Supabase, segnalazioni via
[`SECURITY.md`](../SECURITY.md). Registrare data/ora UTC della scoperta (avvia il cronometro NIS2).

### 4.2 Triage e classificazione
Determinare severità (§2), tenant/dati coinvolti, vettore. Aprire un record incidente (ID, timestamp, owner).

### 4.3 Contenimento
- Compromissione credenziali → **revoca**: incrementare `token_version` dell'utente, inserire `jti` in
  `RevokedToken`, disattivare l'utente/tenant (`is_active=False`).
- Segreto esposto → **rotazione immediata** (`JWT_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL`, chiavi OpenAI/Supabase).
- Endpoint sotto attacco → tightening rate-limit / blocco temporaneo.
- Isolare l'ambiente colpito senza distruggere le evidenze.

### 4.4 Eradicazione e ripristino
Rimuovere la causa (patch, fix di configurazione), verificare l'integrità, ripristinare da backup Supabase
(point-in-time) se necessario. Validare con la suite di test backend prima del ripristino in produzione.

### 4.5 Raccolta evidenze (A.5.28)
Esportare e conservare: log `SystemLog` pertinenti, log infrastruttura, diff del codice, timeline. Conservare
in modo immutabile per almeno la durata richiesta da contratto/legge.

### 4.6 Lezioni apprese
Entro 5 giorni lavorativi: root-cause analysis, azione correttiva tracciata (nuovo finding `SEC-NN` nell'audit),
aggiornamento di linee guida/checklist se emerge un nuovo pattern.

## 5. Notifica NIS2 (Art. 23) — tempistiche

Quando l'incidente è **significativo** e coinvolge un cliente in ambito NIS2, supportare la notifica al
**CSIRT competente** (Italia: https://www.csirt.gov.it) secondo le scadenze:

| Fase | Termine dalla scoperta | Contenuto minimo |
|---|---|---|
| **Early warning** | **24 ore** | Natura sospetta dell'incidente, possibile origine illecita, impatto transfrontaliero |
| **Notifica incidente** | **72 ore** | Valutazione iniziale di gravità/impatto, IoC |
| **Report intermedio** | su richiesta | Aggiornamenti di stato |
| **Report finale** | **1 mese** | Descrizione dettagliata, gravità/impatto, root cause, misure di mitigazione applicate |

Le evidenze del §4.5 (audit trail `SystemLog` con timestamp UTC) alimentano questi report.

## 6. Contatti

- Security mailbox: **security@maintai.example**
- CSIRT Italia: https://www.csirt.gov.it
- Provider infrastruttura: Render, Vercel, Supabase (per evidenze fisiche/infrastrutturali, A.7).

## 7. Checklist rapida incidente

- [ ] Timestamp di scoperta registrato (UTC) — cronometro NIS2 avviato
- [ ] Severità classificata (§2) e Incident Lead assegnato
- [ ] Contenimento eseguito (revoca token / rotazione segreti / blocco)
- [ ] Evidenze raccolte e conservate (`SystemLog` + log infra)
- [ ] Se significativo NIS2: early warning ≤24h, notifica ≤72h pianificate
- [ ] Eradicazione + ripristino verificati con test
- [ ] Root-cause + azione correttiva tracciata (`SEC-NN`)
- [ ] Lezioni apprese e aggiornamento documentazione

---

*Runbook mantenuto insieme all'ISMS. Testare la procedura almeno una volta l'anno (tabletop exercise).*
