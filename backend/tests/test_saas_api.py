"""Test end-to-end del percorso self-service, via HTTP.

Il percorso che un cliente vero attraversa: registrazione → verifica email →
login → checkout simulato → piano attivo → quota che blocca → sola lettura.
Ogni passaggio passa dagli endpoint reali, non dai servizi: è l'unico modo di
accorgersi che un gate manca proprio dove serve.
"""

import os

import pytest

from backend.db.modelli import Subscription, Tenant, Utente
from backend.services.billing import subscription_service as subs

PASSWORD = "Impianto2026!x"


@pytest.fixture(autouse=True)
def _enable_signup(monkeypatch):
    monkeypatch.setenv("SELF_SERVICE_SIGNUP_ENABLED", "true")
    monkeypatch.setenv("BILLING_PROVIDER", "local")


@pytest.fixture
def signup_payload():
    return {
        "email": "responsabile@acciaierie.it",
        "password": PASSWORD,
        "nome_referente": "Marco Rossi",
        "azienda": "Acciaierie del Nord",
        "paese": "IT",
        "accetta_termini": True,
        "accetta_privacy": True,
    }


def _login(client, username, password=PASSWORD):
    return client.post("/auth/login", data={"username": username, "password": password})


# ── Registrazione ────────────────────────────────────────────────────────────


def test_signup_crea_tenant_admin_e_trial(client, db_session, signup_payload):
    resp = client.post("/public/signup", json=signup_payload)
    assert resp.status_code == 201, resp.text

    tenant = db_session.query(Tenant).filter(Tenant.nome == "Acciaierie del Nord").first()
    assert tenant is not None
    assert tenant.slug == "acciaierie-del-nord"
    assert tenant.billing_email == "responsabile@acciaierie.it"
    assert tenant.onboarding_status == "pending"

    admin = db_session.query(Utente).filter(Utente.tenant_id == tenant.id).first()
    assert admin.ruolo == "responsabile"
    assert admin.is_tenant_owner is True
    assert admin.email_verified_at is None  # ancora da confermare

    sub = db_session.query(Subscription).filter(Subscription.tenant_id == tenant.id).first()
    assert sub.status == "trialing"
    assert sub.plan_code == "trial"
    assert sub.trial_ends_at is not None


def test_signup_su_email_esistente_non_rivela_nulla(client, db_session, signup_payload):
    prima = client.post("/public/signup", json=signup_payload)
    dopo = client.post("/public/signup", json=signup_payload)

    assert prima.status_code == dopo.status_code == 201
    # Stesso messaggio: l'endpoint non è un oracolo su quali email hanno account.
    assert prima.json()["message"] == dopo.json()["message"]
    # E nessun secondo tenant creato.
    assert db_session.query(Tenant).filter(Tenant.nome == "Acciaierie del Nord").count() == 1


def test_signup_rifiuta_password_debole(client, signup_payload):
    signup_payload["password"] = "password123"
    resp = client.post("/public/signup", json=signup_payload)
    assert resp.status_code == 422


def test_signup_richiede_i_consensi(client, signup_payload):
    signup_payload["accetta_privacy"] = False
    resp = client.post("/public/signup", json=signup_payload)
    assert resp.status_code == 422


def test_signup_disattivabile_da_env(client, signup_payload, monkeypatch):
    monkeypatch.setenv("SELF_SERVICE_SIGNUP_ENABLED", "false")
    resp = client.post("/public/signup", json=signup_payload)
    assert resp.status_code == 404


def test_verifica_email_e_login(client, db_session, signup_payload):
    signup = client.post("/public/signup", json=signup_payload).json()
    token = signup["dev_verification_token"]  # esposto solo fuori produzione

    verify = client.post("/public/verify-email", json={"token": token})
    assert verify.status_code == 200

    admin = db_session.query(Utente).filter(Utente.username == signup_payload["email"]).first()
    assert admin.email_verified_at is not None

    # Token monouso: la seconda volta non vale più.
    assert client.post("/public/verify-email", json={"token": token}).status_code == 400

    assert _login(client, signup_payload["email"]).status_code == 200


def test_reset_password_invalida_le_sessioni(client, db_session, signup_payload):
    client.post("/public/signup", json=signup_payload)
    admin = db_session.query(Utente).filter(Utente.username == signup_payload["email"]).first()
    token_version_iniziale = admin.token_version

    forgot = client.post("/public/forgot-password", json={"email": signup_payload["email"]})
    reset_url = forgot.json()["dev_reset_url"]
    token = reset_url.split("token=")[1]

    nuova = "NuovaPassword2026!"
    resp = client.post("/public/reset-password", json={"token": token, "new_password": nuova})
    assert resp.status_code == 200

    db_session.refresh(admin)
    assert admin.token_version > token_version_iniziale
    assert _login(client, signup_payload["email"], nuova).status_code == 200


def test_forgot_password_su_email_inesistente_risponde_uguale(client):
    resp = client.post("/public/forgot-password", json={"email": "nessuno@vuoto.it"})
    assert resp.status_code == 200
    assert "dev_reset_url" not in resp.json()


# ── Catalogo e checkout ──────────────────────────────────────────────────────


def test_catalogo_piani_pubblico(client):
    resp = client.get("/billing/plans")
    assert resp.status_code == 200

    data = resp.json()
    codes = {p["code"] for p in data["plans"]}
    assert "start" in codes and "pro" in codes
    assert "trial" not in codes  # il trial non si vende
    assert data["provider"] == "local"


def test_checkout_simulato_attiva_il_piano(client, db_session, signup_payload):
    client.post("/public/signup", json=signup_payload)
    _login(client, signup_payload["email"])

    checkout = client.post("/billing/checkout-session", json={
        "plan_code": "pro", "billing_interval": "monthly",
    })
    assert checkout.status_code == 200, checkout.text
    body = checkout.json()
    assert body["simulated"] is True

    token = body["url"].split("token=")[1]
    confirm = client.post("/billing/simulate-checkout", json={"token": token})
    assert confirm.json()["status"] == "processed"

    tenant = db_session.query(Tenant).filter(Tenant.nome == "Acciaierie del Nord").first()
    sub = db_session.query(Subscription).filter(Subscription.tenant_id == tenant.id).first()
    assert sub.status == "active"
    assert sub.plan_code == "pro"

    # Ripetere la conferma non riattiva nulla: stesso token, stesso evento.
    assert client.post("/billing/simulate-checkout", json={"token": token}).json()["status"] == "duplicate"


def test_checkout_rifiuta_un_piano_non_vendibile(client, signup_payload):
    client.post("/public/signup", json=signup_payload)
    _login(client, signup_payload["email"])

    for plan in ("enterprise", "trial", "piano_inventato"):
        resp = client.post("/billing/checkout-session", json={"plan_code": plan})
        assert resp.status_code == 422, f"piano {plan} non doveva essere acquistabile"


def test_stato_abbonamento_visibile_al_cliente(client, signup_payload):
    client.post("/public/signup", json=signup_payload)
    _login(client, signup_payload["email"])

    resp = client.get("/billing/subscription")
    assert resp.status_code == 200
    data = resp.json()
    assert data["subscription"]["status"] == "trialing"
    assert data["entitlements"]["access_level"] == "full"


def test_usage_riporta_consumo_e_limiti(client, signup_payload):
    client.post("/public/signup", json=signup_payload)
    _login(client, signup_payload["email"])

    resp = client.get("/billing/usage")
    metrics = {m["metric"]: m for m in resp.json()["metrics"]}
    assert metrics["users"]["used"] == 1        # l'amministratore appena creato
    assert metrics["users"]["limit"] == 5       # quote del trial
    assert metrics["sites"]["limit"] == 1


# ── Quote applicate dagli endpoint reali ─────────────────────────────────────


def test_quota_siti_blocca_la_creazione_via_api(client, db_session, signup_payload):
    client.post("/public/signup", json=signup_payload)
    _login(client, signup_payload["email"])

    primo = client.post("/siti", json={"nome": "Stabilimento Nord"})
    assert primo.status_code == 201, primo.text

    secondo = client.post("/siti", json={"nome": "Stabilimento Sud"})
    assert secondo.status_code == 402
    detail = secondo.json()["detail"]
    assert detail["error"] == "plan_limit_reached"
    assert detail["metric"] == "sites"
    assert detail["current"] == 1 and detail["limit"] == 1


def test_quota_utenti_blocca_la_creazione_via_api(client, db_session, signup_payload):
    client.post("/public/signup", json=signup_payload)
    _login(client, signup_payload["email"])

    tenant = db_session.query(Tenant).filter(Tenant.nome == "Acciaierie del Nord").first()
    subs.activate_plan(db_session, tenant.id, "start")  # 3 utenti inclusi
    db_session.commit()

    for i in range(2):
        resp = client.post("/utenti", json={
            "username": f"tecnico{i}@acciaierie.it", "password": PASSWORD, "ruolo": "tecnico",
        })
        assert resp.status_code == 201, resp.text

    quarto = client.post("/utenti", json={
        "username": "tecnico_extra@acciaierie.it", "password": PASSWORD, "ruolo": "tecnico",
    })
    assert quarto.status_code == 402
    assert quarto.json()["detail"]["metric"] == "users"
    # Nessun utente creato a metà: il gate scatta prima della scrittura.
    assert db_session.query(Utente).filter(
        Utente.username == "tecnico_extra@acciaierie.it"
    ).count() == 0


# ── Sola lettura ─────────────────────────────────────────────────────────────


def test_trial_scaduto_blocca_le_scritture_ma_non_le_letture(client, db_session, signup_payload):
    from datetime import datetime, timedelta, timezone

    from backend.services.billing.access_guard import invalidate_access_cache

    client.post("/public/signup", json=signup_payload)
    _login(client, signup_payload["email"])

    tenant = db_session.query(Tenant).filter(Tenant.nome == "Acciaierie del Nord").first()
    sub = db_session.query(Subscription).filter(Subscription.tenant_id == tenant.id).first()
    sub.trial_ends_at = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.commit()
    invalidate_access_cache()

    # Lettura: consentita. Il cliente non perde l'accesso ai propri dati.
    assert client.get("/siti").status_code == 200

    # Scrittura: bloccata, con la ragione esplicita.
    scrittura = client.post("/siti", json={"nome": "Nuovo sito"})
    assert scrittura.status_code == 402
    detail = scrittura.json()["detail"]
    assert detail["error"] == "subscription_inactive"
    assert detail["reason"] == "trial_expired"

    # E l'abbonamento resta raggiungibile: è la via d'uscita.
    assert client.get("/billing/subscription").status_code == 200
    invalidate_access_cache()


def test_pagamento_riporta_l_app_scrivibile(client, db_session, signup_payload):
    from datetime import datetime, timedelta, timezone

    from backend.services.billing.access_guard import invalidate_access_cache

    client.post("/public/signup", json=signup_payload)
    _login(client, signup_payload["email"])

    tenant = db_session.query(Tenant).filter(Tenant.nome == "Acciaierie del Nord").first()
    sub = db_session.query(Subscription).filter(Subscription.tenant_id == tenant.id).first()
    sub.trial_ends_at = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.commit()
    invalidate_access_cache()

    assert client.post("/siti", json={"nome": "Bloccato"}).status_code == 402

    checkout = client.post("/billing/checkout-session", json={"plan_code": "pro"}).json()
    client.post("/billing/simulate-checkout", json={"token": checkout["url"].split("token=")[1]})

    # Nessuna attesa della cache: la conferma del pagamento la invalida.
    assert client.post("/siti", json={"nome": "Sbloccato"}).status_code == 201
    invalidate_access_cache()


def test_disdetta_e_riattivazione_via_api(client, db_session, signup_payload):
    client.post("/public/signup", json=signup_payload)
    _login(client, signup_payload["email"])

    checkout = client.post("/billing/checkout-session", json={"plan_code": "start"}).json()
    client.post("/billing/simulate-checkout", json={"token": checkout["url"].split("token=")[1]})

    disdetta = client.post("/billing/cancel", json={"at_period_end": True, "reason": "prova"})
    assert disdetta.status_code == 200
    assert disdetta.json()["subscription"]["cancel_at_period_end"] is True

    riattiva = client.post("/billing/reactivate")
    assert riattiva.json()["subscription"]["cancel_at_period_end"] is False


def test_tecnico_non_puo_toccare_l_abbonamento(client, db_session, signup_payload):
    client.post("/public/signup", json=signup_payload)
    _login(client, signup_payload["email"])
    client.post("/utenti", json={
        "username": "tecnico@acciaierie.it", "password": PASSWORD, "ruolo": "tecnico",
    })
    client.post("/auth/logout")
    _login(client, "tecnico@acciaierie.it")

    # Vedere lo stato sì (serve a capire perché l'app è bloccata)...
    assert client.get("/billing/subscription").status_code == 200
    # ...spendere no.
    assert client.post("/billing/checkout-session", json={"plan_code": "pro"}).status_code == 403
    assert client.post("/billing/cancel", json={}).status_code == 403


# ── Webhook ──────────────────────────────────────────────────────────────────


def test_webhook_locale_richiede_il_segreto(client, monkeypatch):
    monkeypatch.setenv("BILLING_WEBHOOK_SECRET", "segreto-di-prova")

    senza = client.post("/billing/webhook", json={"id": "evt_x", "type": "invoice.paid"})
    assert senza.status_code == 401

    con = client.post(
        "/billing/webhook",
        json={"id": "evt_x", "type": "invoice.paid", "data": {}, "metadata": {}},
        headers={"x-billing-secret": "segreto-di-prova"},
    )
    assert con.status_code == 200


def test_webhook_chiuso_se_non_configurato(client, monkeypatch):
    monkeypatch.delenv("BILLING_WEBHOOK_SECRET", raising=False)
    resp = client.post("/billing/webhook", json={"id": "evt_y", "type": "invoice.paid"})
    assert resp.status_code == 404
