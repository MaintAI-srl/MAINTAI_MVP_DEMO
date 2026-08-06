"""Test degli eventi di billing: idempotenza, ordine, effetti sull'abbonamento.

Il test centrale è `test_evento_duplicato_non_viene_riapplicato`: è la proprietà
per cui esiste `subscription_events`. Stripe consegna *at-least-once*, e un
`invoice.paid` applicato due volte regala un mese di servizio.
"""

from datetime import datetime, timedelta, timezone

import pytest

from backend.db.modelli import Subscription, SubscriptionEvent, Tenant
from backend.services.billing import subscription_service as subs
from backend.services.billing.providers import BillingEvent
from backend.services.billing.webhook_service import process_event


def _utcnow():
    return datetime.now(timezone.utc)


@pytest.fixture
def tenant(db_session):
    t = Tenant(nome="Portuale SpA", slug="portuale-spa", is_active=True)
    db_session.add(t)
    db_session.commit()
    return t


def _event(tenant_id, event_type, event_id, **kwargs) -> BillingEvent:
    now = _utcnow()
    defaults = dict(
        provider="local",
        plan_code="start",
        billing_interval="monthly",
        customer_id="cus_test",
        subscription_id="sub_test",
        status=None,
        period_start=now,
        period_end=now + timedelta(days=30),
        extra_users=None,
        extra_sites=None,
        payload_hash=f"hash-{event_id}",
    )
    defaults.update(kwargs)
    return BillingEvent(
        event_id=event_id,
        event_type=event_type,
        tenant_id=tenant_id,
        **defaults,
    )


def _subscription(db, tenant_id):
    return db.query(Subscription).filter(Subscription.tenant_id == tenant_id).first()


# ── Idempotenza ──────────────────────────────────────────────────────────────


def test_evento_duplicato_non_viene_riapplicato(db_session, tenant):
    event = _event(tenant.id, "checkout.session.completed", "evt_dup_1")

    first = process_event(db_session, event)
    period_end_dopo_primo = _subscription(db_session, tenant.id).current_period_end

    second = process_event(db_session, event)

    assert first.status == "processed"
    assert second.status == "duplicate"
    # Il periodo non si è spostato: l'effetto è avvenuto una volta sola.
    assert _subscription(db_session, tenant.id).current_period_end == period_end_dopo_primo
    assert db_session.query(SubscriptionEvent).filter(
        SubscriptionEvent.provider_event_id == "evt_dup_1"
    ).count() == 1


def test_rinnovo_duplicato_non_regala_un_periodo(db_session, tenant):
    process_event(db_session, _event(tenant.id, "checkout.session.completed", "evt_ck_1"))

    rinnovo = _event(
        tenant.id, "invoice.paid", "evt_inv_1",
        period_start=_utcnow(), period_end=_utcnow() + timedelta(days=30),
    )
    process_event(db_session, rinnovo)
    fine_periodo = _subscription(db_session, tenant.id).current_period_end

    process_event(db_session, rinnovo)  # stessa consegna, ritentata dal provider
    assert _subscription(db_session, tenant.id).current_period_end == fine_periodo


# ── Effetti dei singoli eventi ───────────────────────────────────────────────


def test_checkout_completato_attiva_il_piano(db_session, tenant):
    result = process_event(db_session, _event(tenant.id, "checkout.session.completed", "evt_ck_2"))

    sub = _subscription(db_session, tenant.id)
    assert result.status == "processed"
    assert sub.status == "active"
    assert sub.plan_code == "start"
    assert sub.provider_customer_id == "cus_test"
    # Il trial si chiude col pagamento: niente seconda finestra gratuita.
    assert sub.trial_ends_at is None


def test_pagamento_fallito_apre_la_tolleranza(db_session, tenant):
    process_event(db_session, _event(tenant.id, "checkout.session.completed", "evt_ck_3"))
    process_event(db_session, _event(tenant.id, "invoice.payment_failed", "evt_fail_1"))

    sub = _subscription(db_session, tenant.id)
    assert sub.status == "past_due"
    assert sub.grace_period_ends_at is not None


def test_pagamento_riuscito_chiude_la_morosita(db_session, tenant):
    process_event(db_session, _event(tenant.id, "checkout.session.completed", "evt_ck_4"))
    process_event(db_session, _event(tenant.id, "invoice.payment_failed", "evt_fail_2"))
    process_event(db_session, _event(tenant.id, "invoice.paid", "evt_paid_2"))

    sub = _subscription(db_session, tenant.id)
    assert sub.status == "active"
    assert sub.grace_period_ends_at is None


def test_subscription_deleted_chiude_l_abbonamento(db_session, tenant):
    process_event(db_session, _event(tenant.id, "checkout.session.completed", "evt_ck_5"))
    process_event(db_session, _event(tenant.id, "customer.subscription.deleted", "evt_del_1"))

    assert _subscription(db_session, tenant.id).status == "cancelled"


def test_stato_canceled_di_stripe_viene_normalizzato(db_session, tenant):
    """Stripe scrive 'canceled', il modello dati usa 'cancelled'."""
    process_event(db_session, _event(tenant.id, "checkout.session.completed", "evt_ck_6"))
    process_event(db_session, _event(
        tenant.id, "customer.subscription.updated", "evt_upd_1", status="canceled",
    ))

    assert _subscription(db_session, tenant.id).status == "cancelled"


def test_subscription_updated_riallinea_il_piano(db_session, tenant):
    process_event(db_session, _event(tenant.id, "checkout.session.completed", "evt_ck_7"))
    process_event(db_session, _event(
        tenant.id, "customer.subscription.updated", "evt_upd_2",
        plan_code="pro", status="active", extra_users=4,
    ))

    sub = _subscription(db_session, tenant.id)
    assert sub.plan_code == "pro"
    assert sub.extra_users == 4


# ── Robustezza ───────────────────────────────────────────────────────────────


def test_evento_senza_tenant_viene_registrato_come_errore(db_session):
    result = process_event(db_session, _event(None, "invoice.paid", "evt_orfano_1"))

    assert result.status == "error"
    row = db_session.query(SubscriptionEvent).filter(
        SubscriptionEvent.provider_event_id == "evt_orfano_1"
    ).first()
    # Non si perde: la riga è la coda di riconciliazione.
    assert row.processing_status == "error"


def test_evento_non_gestito_viene_registrato_come_ignorato(db_session, tenant):
    result = process_event(db_session, _event(tenant.id, "customer.discount.created", "evt_ign_1"))

    assert result.status == "ignored"
    row = db_session.query(SubscriptionEvent).filter(
        SubscriptionEvent.provider_event_id == "evt_ign_1"
    ).first()
    assert row.processing_status == "ignored"


def test_piano_sconosciuto_nel_checkout_ricade_sul_default(db_session, tenant):
    """Un price id mappato male non deve lasciare il cliente senza servizio."""
    process_event(db_session, _event(
        tenant.id, "checkout.session.completed", "evt_ck_8", plan_code="piano_inesistente",
    ))

    sub = _subscription(db_session, tenant.id)
    assert sub.status == "active"
    assert sub.plan_code == "start"


def test_checkout_su_tenant_in_trial_sostituisce_il_trial(db_session, tenant):
    subs.start_trial(db_session, tenant.id)
    db_session.commit()

    process_event(db_session, _event(tenant.id, "checkout.session.completed", "evt_ck_9", plan_code="pro"))

    sub = _subscription(db_session, tenant.id)
    assert sub.status == "active"
    assert sub.plan_code == "pro"
    assert db_session.query(Subscription).filter(Subscription.tenant_id == tenant.id).count() == 1
