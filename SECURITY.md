# Security Policy — MaintAI

> Coordinated Vulnerability Disclosure & supporto agli obblighi NIS2 / ISO 27001.
> Versione 1.0 — 2026-06-08. Riferimenti: ISO/IEC 27001:2022 A.8.8 (gestione vulnerabilità),
> A.5.5 (contatti con le autorità), Direttiva (UE) 2022/2555 (NIS2) Art. 21(2)(e) e Art. 23.

## Versioni supportate

| Versione | Supportata |
|---|---|
| 3.3.x | ✅ |
| < 3.3 | ❌ |

## Segnalare una vulnerabilità

Se individui una vulnerabilità di sicurezza in MaintAI:

1. **NON** aprire una issue pubblica su GitHub e non divulgare pubblicamente i dettagli.
2. Invia una segnalazione privata a **security@maintai.example** (sostituire con la mailbox reale)
   includendo: descrizione, impatto stimato, passi di riproduzione e, se possibile, una PoC.
3. Riceverai un **acknowledgement entro 48 ore** lavorative.

### Tempi di gestione (SLA interni)

| Severità | Triage | Fix target |
|---|---|---|
| 🔴 Critica | 24h | il prima possibile / hotfix |
| 🟠 Alta | 72h | 7 giorni |
| 🟡 Media | 5 giorni | 30 giorni |
| 🟢 Bassa | 10 giorni | prossimo ciclo |

La scala di severità segue [`docs/SECURITY_CHECKLIST.md`](docs/SECURITY_CHECKLIST.md).

## Disclosure coordinata

Pratichiamo la **coordinated disclosure**: chiediamo di non divulgare i dettagli finché non è
disponibile una patch e i clienti impattati sono stati avvisati. Riconosciamo pubblicamente i
ricercatori che lo desiderano dopo la risoluzione.

## Obblighi NIS2 (Art. 23) lungo la catena di fornitura

MaintAI è fornitore ICT per soggetti che possono rientrare nell'ambito NIS2. In caso di incidente
**significativo** che coinvolga dati o servizi di un cliente, attiviamo il runbook
[`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md) e supportiamo il cliente nelle notifiche al
CSIRT competente entro le tempistiche di legge (**early warning 24h, notifica 72h, report finale 1 mese**).

## Hardening e processo

- Dipendenze pinnate e CI di audit (`pip-audit`, `npm audit`) — `.github/workflows/security.yml`.
- Secret scanning (gitleaks) su ogni push/PR.
- Audit di sicurezza periodici archiviati in `docs/SECURITY_AUDIT_*`.
- Linee guida di sviluppo sicuro: `docs/SECURITY_GUIDELINES*.md`.

## Contatti

- Segnalazioni di sicurezza: **security@maintai.example**
- CSIRT Italia (riferimento NIS2): https://www.csirt.gov.it
