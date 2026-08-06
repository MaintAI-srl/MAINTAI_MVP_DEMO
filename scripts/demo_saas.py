#!/usr/bin/env python
"""Dimostrazione del percorso SaaS self-service, senza avviare nulla.

    python scripts/demo_saas.py

Percorre in sequenza tutto ciò che un cliente vero attraversa — registrazione,
verifica email, prova gratuita, quota superata, pagamento, upgrade, scadenza,
sola lettura, riattivazione — chiamando gli **endpoint reali** tramite il
TestClient di FastAPI e stampando ogni passaggio con il suo esito.

Non è un test: i test stanno in `backend/tests/`. È uno strumento per *vedere*
il comportamento, utile a chi deve decidere se il modello commerciale regge
prima di collegarci Stripe.

Il database è un file temporaneo, cancellato all'uscita: nessun dato reale
viene toccato.
"""

from __future__ import annotations

import os
import secrets
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# L'ambiente va preparato PRIMA di importare il backend: `core/security.py`
# legge JWT_SECRET e ENCRYPTION_KEY al momento dell'import e rifiuta di
# proseguire se mancano.
_tmpdir = tempfile.mkdtemp(prefix="maintai-demo-saas-")
_db_path = Path(_tmpdir) / "demo_saas.db"

os.environ.setdefault("JWT_SECRET", secrets.token_hex(32))
if not os.getenv("ENCRYPTION_KEY"):
    from cryptography.fernet import Fernet

    os.environ["ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["DATABASE_URL"] = f"sqlite:///{_db_path}"
os.environ["SELF_SERVICE_SIGNUP_ENABLED"] = "true"
os.environ["BILLING_PROVIDER"] = "local"
os.environ["BILLING_WEBHOOK_SECRET"] = "segreto-demo"
os.environ["APP_PUBLIC_URL"] = "http://localhost:3000"
os.environ.setdefault("TRIAL_DAYS", "14")


# ── Presentazione ────────────────────────────────────────────────────────────

VERDE, ROSSO, GIALLO, BLU, GRIGIO, RESET = (
    "\033[32m", "\033[31m", "\033[33m", "\033[36m", "\033[90m", "\033[0m"
)
if not sys.stdout.isatty():
    VERDE = ROSSO = GIALLO = BLU = GRIGIO = RESET = ""

_passo = 0


def titolo(testo: str) -> None:
    global _passo
    _passo += 1
    print(f"\n{BLU}{'─' * 74}{RESET}")
    print(f"{BLU}  {_passo}. {testo}{RESET}")
    print(f"{BLU}{'─' * 74}{RESET}")


def esito(ok: bool, testo: str) -> None:
    print(f"  {VERDE + '✓' if ok else ROSSO + '✗'}{RESET} {testo}")


def nota(testo: str) -> None:
    print(f"  {GRIGIO}{testo}{RESET}")


def avviso(testo: str) -> None:
    print(f"  {GIALLO}▸{RESET} {testo}")


def chiamata(metodo: str, path: str, risposta) -> None:
    colore = VERDE if risposta.status_code < 400 else GIALLO if risposta.status_code < 500 else ROSSO
    print(f"  {GRIGIO}{metodo:6}{path:38}{RESET} → {colore}{risposta.status_code}{RESET}")


# ── Percorso ─────────────────────────────────────────────────────────────────

EMAIL = "responsabile@officina-demo.it"
PASSWORD = "Manutenzione2026!"


def main() -> int:
    from fastapi.testclient import TestClient

    from backend.main import app

    print(f"\n{BLU}╔{'═' * 72}╗{RESET}")
    print(f"{BLU}║  MaintAI — dimostrazione del percorso SaaS self-service{' ' * 17}║{RESET}")
    print(f"{BLU}╚{'═' * 72}╝{RESET}")
    nota(f"database temporaneo: {_db_path}")

    with TestClient(app, base_url="https://demo", headers={"origin": "http://localhost:3000"}) as client:
        # ── 1 ────────────────────────────────────────────────────────────────
        titolo("Il visitatore guarda il listino (endpoint pubblico, nessuna sessione)")
        r = client.get("/billing/plans")
        chiamata("GET", "/billing/plans", r)
        listino = r.json()
        for plan in listino["plans"]:
            prezzo = f"{plan['price_monthly'] / 100:>7.0f} €/mese" if plan["is_self_serve"] else "   su richiesta"
            nota(f"{plan['name']:<14} {prezzo}   "
                 f"{plan['included_users']:>3} utenti · {plan['included_sites']:>2} siti · {plan['included_assets']:>4} asset")
        esito("trial" not in {p["code"] for p in listino["plans"]},
              "il piano di prova non compare a listino: non è un prodotto vendibile")
        esito(listino["provider"] == "local", f"provider di pagamento attivo: {listino['provider']} (checkout simulato)")

        # ── 2 ────────────────────────────────────────────────────────────────
        titolo("Registrazione: azienda + amministratore + prova, in un'unica transazione")
        r = client.post("/public/signup", json={
            "email": EMAIL,
            "password": PASSWORD,
            "nome_referente": "Marco Rossi",
            "azienda": "Officina Meccanica Demo",
            "paese": "IT",
            "vat_number": "IT01234567890",
            "accetta_termini": True,
            "accetta_privacy": True,
        })
        chiamata("POST", "/public/signup", r)
        if r.status_code != 201:
            esito(False, f"registrazione fallita: {r.text}")
            return 1
        signup = r.json()
        nota(f"area creata: /{signup['tenant_slug']} — prova di {signup['trial_days']} giorni")

        # ── 3 ────────────────────────────────────────────────────────────────
        titolo("Registrazione con la stessa email: la risposta non cambia")
        r2 = client.post("/public/signup", json={
            "email": EMAIL, "password": PASSWORD, "nome_referente": "Chi Sonda",
            "azienda": "Sonda SRL", "paese": "IT",
            "accetta_termini": True, "accetta_privacy": True,
        })
        chiamata("POST", "/public/signup", r2)
        esito(r2.json()["message"] == signup["message"],
              "messaggio identico: l'endpoint non rivela quali email hanno un account")

        # ── 4 ────────────────────────────────────────────────────────────────
        titolo("Verifica dell'indirizzo (token monouso, conservato solo come hash)")
        token = signup["dev_verification_token"]
        nota("il token è nella risposta solo fuori produzione: senza SMTP sarebbe irraggiungibile")
        r = client.post("/public/verify-email", json={"token": token})
        chiamata("POST", "/public/verify-email", r)
        r = client.post("/public/verify-email", json={"token": token})
        chiamata("POST", "/public/verify-email", r)
        esito(r.status_code == 400, "il secondo tentativo con lo stesso token viene rifiutato")

        # ── 5 ────────────────────────────────────────────────────────────────
        titolo("Accesso e stato dell'abbonamento")
        r = client.post("/auth/login", data={"username": EMAIL, "password": PASSWORD})
        chiamata("POST", "/auth/login", r)
        if r.status_code != 200:
            esito(False, f"login fallito: {r.text}")
            return 1

        stato = client.get("/billing/subscription").json()
        ent = stato["entitlements"]
        nota(f"piano {ent['plan_name']} · stato {ent['status']} · accesso {ent['access_level']}")
        nota(f"limiti: {ent['limits']}")
        esito(ent["access_level"] == "full", "in prova si lavora senza restrizioni")

        # ── 6 ────────────────────────────────────────────────────────────────
        titolo("La quota morde dove serve: creazione siti")
        r = client.post("/siti", json={"nome": "Stabilimento Nord"})
        chiamata("POST", "/siti", r)
        esito(r.status_code == 201, "primo sito creato (1 incluso nella prova)")

        r = client.post("/siti", json={"nome": "Stabilimento Sud"})
        chiamata("POST", "/siti", r)
        dettaglio = r.json().get("detail", {})
        esito(r.status_code == 402, "secondo sito bloccato prima della scrittura")
        avviso(f"{dettaglio.get('metric_label')}: {dettaglio.get('current')}/{dettaglio.get('limit')} "
               f"→ {dettaglio.get('upgrade_url')}")
        nota("il 402 porta metrica, consumo e limite: la UI può proporre l'upgrade senza svuotare il form")

        # ── 7 ────────────────────────────────────────────────────────────────
        titolo("Il piano è anche un tetto sui moduli")
        moduli = client.get("/modules").json()
        attivi = set(moduli["enabled"])
        nota(f"moduli attivi con la prova: {len(attivi)}")
        esito("diagnostic_ai" in attivi, "la prova mostra il prodotto completo, diagnostica AI inclusa")

        # ── 8 ────────────────────────────────────────────────────────────────
        titolo("Pagamento: checkout → conferma → piano attivo")
        r = client.post("/billing/checkout-session", json={"plan_code": "pro", "billing_interval": "monthly"})
        chiamata("POST", "/billing/checkout-session", r)
        checkout = r.json()
        avviso(f"pagamento {'SIMULATO' if checkout['simulated'] else 'reale'} — {checkout['url'][:58]}…")

        token_checkout = checkout["url"].split("token=")[1]
        r = client.post("/billing/simulate-checkout", json={"token": token_checkout})
        chiamata("POST", "/billing/simulate-checkout", r)
        esito(r.json()["status"] == "processed", "abbonamento attivato")

        r = client.post("/billing/simulate-checkout", json={"token": token_checkout})
        chiamata("POST", "/billing/simulate-checkout", r)
        esito(r.json()["status"] == "duplicate",
              "la stessa conferma, ripetuta, viene scartata: nessun doppio addebito di periodo")

        # ── 9 ────────────────────────────────────────────────────────────────
        titolo("Dopo l'upgrade la quota si è alzata")
        r = client.post("/siti", json={"nome": "Stabilimento Sud"})
        chiamata("POST", "/siti", r)
        esito(r.status_code == 201, "il secondo sito ora si crea (piano Professional: 3 siti)")

        uso = client.get("/billing/usage").json()
        for m in uso["metrics"]:
            limite = "illimitato" if m["unlimited"] else str(m["limit"])
            nota(f"{m['label']:<20} {m['used']:>4} / {limite}")

        # ── 10 ───────────────────────────────────────────────────────────────
        titolo("Pagamento fallito: tolleranza, non blocco")
        tenant_id = ent["tenant_id"]
        r = client.post(
            "/billing/webhook",
            json={"id": "evt_demo_fail", "type": "invoice.payment_failed",
                  "metadata": {"tenant_id": str(tenant_id)}, "data": {}},
            headers={"x-billing-secret": "segreto-demo"},
        )
        chiamata("POST", "/billing/webhook", r)
        _svuota_cache()
        stato = client.get("/billing/subscription").json()
        esito(stato["entitlements"]["access_level"] == "full",
              f"stato «{stato['entitlements']['status']}» ma accesso ancora pieno")
        for w in stato["entitlements"]["warnings"]:
            avviso(w)
        nota("una carta scaduta non deve fermare la manutenzione di uno stabilimento")

        r = client.post(
            "/billing/webhook",
            json={"id": "evt_demo_fail", "type": "invoice.payment_failed",
                  "metadata": {"tenant_id": str(tenant_id)}, "data": {}},
            headers={"x-billing-secret": "segreto-demo"},
        )
        esito(r.json()["status"] == "duplicate", "webhook ritentato dal provider: ignorato")

        # ── 11 ───────────────────────────────────────────────────────────────
        titolo("Tolleranza esaurita: sola lettura, mai blocco totale")
        _scadi_tolleranza(tenant_id)
        _svuota_cache()

        r = client.get("/siti")
        chiamata("GET", "/siti", r)
        esito(r.status_code == 200, "i dati restano leggibili")

        r = client.post("/siti", json={"nome": "Terzo sito"})
        chiamata("POST", "/siti", r)
        dettaglio = r.json().get("detail", {})
        esito(r.status_code == 402, f"le scritture sono bloccate ({dettaglio.get('reason')})")

        r = client.get("/billing/subscription")
        chiamata("GET", "/billing/subscription", r)
        esito(r.status_code == 200, "l'abbonamento resta raggiungibile: è la via d'uscita")

        # ── 12 ───────────────────────────────────────────────────────────────
        titolo("Il pagamento riporta l'app scrivibile")
        r = client.post(
            "/billing/webhook",
            json={"id": "evt_demo_paid", "type": "invoice.paid",
                  "metadata": {"tenant_id": str(tenant_id)}, "data": {}},
            headers={"x-billing-secret": "segreto-demo"},
        )
        chiamata("POST", "/billing/webhook", r)
        _svuota_cache()
        r = client.post("/siti", json={"nome": "Terzo sito"})
        chiamata("POST", "/siti", r)
        esito(r.status_code == 201, "si torna a lavorare, senza intervento manuale di nessuno")

        # ── 13 ───────────────────────────────────────────────────────────────
        titolo("Disdetta e riattivazione, in autonomia")
        r = client.post("/billing/cancel", json={"at_period_end": True, "reason": "prova della funzione"})
        chiamata("POST", "/billing/cancel", r)
        sub = r.json()["subscription"]
        esito(sub["cancel_at_period_end"], "disdetta a fine periodo: il tempo già pagato resta del cliente")

        r = client.post("/billing/reactivate")
        chiamata("POST", "/billing/reactivate", r)
        esito(not r.json()["subscription"]["cancel_at_period_end"], "riattivato")

        # ── 14 ───────────────────────────────────────────────────────────────
        titolo("Un cliente storico, senza abbonamento, non subisce nulla")
        legacy_id = _crea_tenant_legacy()
        _svuota_cache()
        stato = _entitlements_di(legacy_id)
        esito(stato.grandfathered, "nessun abbonamento → nessun limite di piano")
        esito(stato.access_level == "full", "accesso pieno: il livello commerciale si attiva sottoscrivendo")

        print(f"\n{VERDE}{'─' * 74}{RESET}")
        print(f"{VERDE}  Percorso completato.{RESET}")
        print(f"{GRIGIO}  Provalo dall'interfaccia: docs/SAAS_SELF_SERVICE.md §3.2{RESET}")
        print(f"{VERDE}{'─' * 74}{RESET}\n")

    return 0


# ── Utilità che agiscono direttamente sul DB (scorciatoie della demo) ────────


def _svuota_cache() -> None:
    """Il gate di scrittura ha una cache di 15 secondi: qui si vuole vedere subito."""
    from backend.services.billing.access_guard import invalidate_access_cache

    invalidate_access_cache()


def _scadi_tolleranza(tenant_id: int) -> None:
    from backend.core.database import SessionLocal
    from backend.db.modelli import Subscription

    db = SessionLocal()
    try:
        sub = db.query(Subscription).filter(Subscription.tenant_id == tenant_id).first()
        sub.grace_period_ends_at = datetime.now(timezone.utc) - timedelta(hours=1)
        db.commit()
    finally:
        db.close()


def _crea_tenant_legacy() -> int:
    from backend.core.database import SessionLocal
    from backend.db.modelli import Tenant

    db = SessionLocal()
    try:
        tenant = Tenant(nome="Cliente Storico", slug="cliente-storico", is_active=True)
        db.add(tenant)
        db.commit()
        return tenant.id
    finally:
        db.close()


def _entitlements_di(tenant_id: int):
    from backend.core.database import SessionLocal
    from backend.services.billing.entitlement_service import resolve_entitlements

    db = SessionLocal()
    try:
        return resolve_entitlements(db, tenant_id)
    finally:
        db.close()


if __name__ == "__main__":
    import shutil

    try:
        codice = main()
    finally:
        shutil.rmtree(_tmpdir, ignore_errors=True)
    sys.exit(codice)
