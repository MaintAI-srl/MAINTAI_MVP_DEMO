"""Ciclo di vita dell'abbonamento: trial, attivazione, cambio piano, disdetta.

Tutte le transizioni di stato passano da qui. Nessun endpoint scrive
`subscription.status` a mano: uno stato scritto in due punti diversi è uno stato
che prima o poi diverge.

Il servizio è **agnostico rispetto al provider**: opera sulla riga locale. Chi
parla con Stripe è `providers.py`; chi applica gli eventi in arrivo è
`webhook_service.py`, e lo fa chiamando queste stesse funzioni.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from backend.core.plans import (
    DEFAULT_PLAN_CODE,
    TRIAL_PLAN_CODE,
    get_plan,
    require_plan,
)

logger = logging.getLogger(__name__)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _grace_days() -> int:
    try:
        return max(0, int(os.getenv("BILLING_GRACE_DAYS", "7")))
    except ValueError:
        return 7


def _period_end(start: datetime, interval: str) -> datetime:
    """Fine periodo. Approssimazione volutamente grossolana per il provider locale.

    Il calendario commerciale vero (mesi di lunghezza diversa, prorate, fusi
    orari di fatturazione) lo fa il provider di pagamento: quando c'è Stripe,
    `current_period_end` arriva dal webhook e questa funzione non viene usata.
    """
    return start + (timedelta(days=365) if interval == "yearly" else timedelta(days=30))


def get_subscription(db: Session, tenant_id: int):
    from backend.db.modelli import Subscription

    return db.query(Subscription).filter(Subscription.tenant_id == tenant_id).first()


def ensure_subscription(db: Session, tenant_id: int, plan_code: str = TRIAL_PLAN_CODE, provider: str = "local"):
    """Restituisce l'abbonamento del tenant, creandolo se manca.

    Usata dalla registrazione self-service e dagli strumenti di
    amministrazione. **Non** viene chiamata implicitamente in lettura: un tenant
    storico senza abbonamento deve restare senza abbonamento (grandfathered),
    non ritrovarsi un trial che scade fra due settimane.
    """
    existing = get_subscription(db, tenant_id)
    if existing:
        return existing
    return start_trial(db, tenant_id, plan_code=plan_code, provider=provider)


def start_trial(db: Session, tenant_id: int, plan_code: str = TRIAL_PLAN_CODE, provider: str = "local"):
    from backend.db.modelli import Subscription

    plan = require_plan(plan_code)
    now = _utcnow()
    trial_days = plan.trial_days or int(os.getenv("TRIAL_DAYS", "14"))

    subscription = Subscription(
        tenant_id=tenant_id,
        provider=provider,
        plan_code=plan.code,
        status="trialing",
        billing_interval="monthly",
        currency="EUR",
        trial_ends_at=now + timedelta(days=trial_days),
        current_period_start=now,
        current_period_end=now + timedelta(days=trial_days),
    )
    db.add(subscription)
    db.flush()
    logger.info("billing: trial avviato per tenant %s (piano %s, %s giorni)", tenant_id, plan.code, trial_days)
    return subscription


def activate_plan(
    db: Session,
    tenant_id: int,
    plan_code: str,
    billing_interval: str = "monthly",
    provider: str = "local",
    provider_customer_id: str | None = None,
    provider_subscription_id: str | None = None,
    extra_users: int | None = None,
    extra_sites: int | None = None,
    period_start: datetime | None = None,
    period_end: datetime | None = None,
):
    """Porta l'abbonamento a `active` sul piano indicato.

    È il punto di atterraggio sia del checkout locale simulato sia del webhook
    `checkout.session.completed` di Stripe: un solo percorso di attivazione,
    quindi un solo comportamento da testare.
    """
    plan = require_plan(plan_code)
    subscription = get_subscription(db, tenant_id)
    now = _utcnow()

    if subscription is None:
        from backend.db.modelli import Subscription

        subscription = Subscription(tenant_id=tenant_id)
        db.add(subscription)

    subscription.provider = provider
    subscription.plan_code = plan.code
    subscription.status = "active"
    subscription.billing_interval = billing_interval if billing_interval in ("monthly", "yearly") else "monthly"
    subscription.currency = "EUR"
    subscription.cancel_at_period_end = False
    subscription.cancelled_at = None
    subscription.grace_period_ends_at = None
    # Il trial finisce nel momento in cui si paga: lasciarlo aperto darebbe una
    # seconda finestra gratuita a chi fa upgrade e poi disdice.
    subscription.trial_ends_at = None

    if provider_customer_id:
        subscription.provider_customer_id = provider_customer_id
    if provider_subscription_id:
        subscription.provider_subscription_id = provider_subscription_id
    if extra_users is not None:
        subscription.extra_users = max(0, int(extra_users))
    if extra_sites is not None:
        subscription.extra_sites = max(0, int(extra_sites))

    start = period_start or now
    subscription.current_period_start = start
    subscription.current_period_end = period_end or _period_end(start, subscription.billing_interval)

    db.flush()
    logger.info("billing: piano %s attivato per tenant %s (provider %s)", plan.code, tenant_id, provider)
    return subscription


def change_plan(db: Session, tenant_id: int, plan_code: str, billing_interval: str | None = None):
    """Upgrade/downgrade sul provider locale.

    Con Stripe il cambio piano è una modifica della subscription lato provider e
    torna via webhook: qui si tocca solo lo specchio locale, ed è per questo che
    la route rifiuta il cambio diretto quando `provider == "stripe"`.
    """
    plan = require_plan(plan_code)
    subscription = get_subscription(db, tenant_id)
    if subscription is None:
        return activate_plan(db, tenant_id, plan_code, billing_interval or "monthly")

    previous = subscription.plan_code
    subscription.plan_code = plan.code
    if billing_interval in ("monthly", "yearly"):
        subscription.billing_interval = billing_interval
    if subscription.status in ("cancelled", "unpaid", "paused"):
        subscription.status = "active"
        subscription.cancelled_at = None
        subscription.cancel_at_period_end = False
        start = _utcnow()
        subscription.current_period_start = start
        subscription.current_period_end = _period_end(start, subscription.billing_interval)

    db.flush()
    logger.info("billing: tenant %s da piano %s a %s", tenant_id, previous, plan.code)
    return subscription


def set_addon_quantities(db: Session, tenant_id: int, extra_users: int | None = None, extra_sites: int | None = None):
    """Aggiorna le licenze aggiuntive.

    Un decremento non può scendere sotto il consumo reale: togliere licenze già
    occupate produrrebbe un tenant istantaneamente fuori quota, che non può né
    lavorare né capire perché.
    """
    from backend.core.plans import METRIC_SITES, METRIC_USERS
    from backend.services.billing.entitlement_service import current_usage

    subscription = get_subscription(db, tenant_id)
    if subscription is None:
        raise ValueError("Nessun abbonamento attivo per questo tenant")

    plan = require_plan(subscription.plan_code)

    if extra_users is not None:
        wanted = max(0, int(extra_users))
        used = current_usage(db, tenant_id, METRIC_USERS)
        minimum = max(0, used - plan.included_users)
        subscription.extra_users = max(wanted, minimum)
    if extra_sites is not None:
        wanted = max(0, int(extra_sites))
        used = current_usage(db, tenant_id, METRIC_SITES)
        minimum = max(0, used - plan.included_sites)
        subscription.extra_sites = max(wanted, minimum)

    db.flush()
    return subscription


def cancel_subscription(db: Session, tenant_id: int, at_period_end: bool = True, reason: str | None = None):
    """Disdetta. Di default a fine periodo: il cliente ha già pagato quel tempo."""
    subscription = get_subscription(db, tenant_id)
    if subscription is None:
        raise ValueError("Nessun abbonamento attivo per questo tenant")

    now = _utcnow()
    if at_period_end and subscription.current_period_end:
        subscription.cancel_at_period_end = True
        subscription.cancelled_at = now
        # Lo stato resta 'active': l'accesso continua fino a scadenza, ed è
        # `_resolve_access` a leggere `cancel_at_period_end` per il banner.
    else:
        subscription.cancel_at_period_end = False
        subscription.cancelled_at = now
        subscription.status = "cancelled"
        subscription.current_period_end = now

    db.flush()
    logger.info("billing: disdetta tenant %s (fine periodo=%s, motivo=%r)", tenant_id, at_period_end, reason)
    return subscription


def reactivate_subscription(db: Session, tenant_id: int):
    """Annulla una disdetta programmata, o riattiva un abbonamento già chiuso."""
    subscription = get_subscription(db, tenant_id)
    if subscription is None:
        raise ValueError("Nessun abbonamento attivo per questo tenant")

    subscription.cancel_at_period_end = False
    subscription.cancelled_at = None

    if subscription.status == "cancelled":
        plan_code = subscription.plan_code if get_plan(subscription.plan_code) else DEFAULT_PLAN_CODE
        return activate_plan(
            db, tenant_id, plan_code,
            billing_interval=subscription.billing_interval,
            provider=subscription.provider,
        )

    db.flush()
    return subscription


def mark_past_due(db: Session, tenant_id: int):
    """Pagamento fallito: si apre la finestra di tolleranza, l'accesso resta pieno."""
    subscription = get_subscription(db, tenant_id)
    if subscription is None:
        return None
    subscription.status = "past_due"
    if not subscription.grace_period_ends_at:
        subscription.grace_period_ends_at = _utcnow() + timedelta(days=_grace_days())
    db.flush()
    return subscription


def mark_unpaid(db: Session, tenant_id: int):
    subscription = get_subscription(db, tenant_id)
    if subscription is None:
        return None
    subscription.status = "unpaid"
    db.flush()
    return subscription


def renew_period(db: Session, tenant_id: int, period_start: datetime | None = None, period_end: datetime | None = None):
    """Fattura pagata: si chiude l'eventuale stato di morosità e si sposta il periodo."""
    subscription = get_subscription(db, tenant_id)
    if subscription is None:
        return None

    start = period_start or _utcnow()
    subscription.status = "active"
    subscription.grace_period_ends_at = None
    subscription.current_period_start = start
    subscription.current_period_end = period_end or _period_end(start, subscription.billing_interval)
    db.flush()
    return subscription


def subscription_to_dict(subscription) -> dict | None:
    if subscription is None:
        return None
    plan = get_plan(subscription.plan_code)
    return {
        "plan_code": subscription.plan_code,
        "plan_name": plan.name if plan else subscription.plan_code,
        "status": subscription.status,
        "provider": subscription.provider,
        "billing_interval": subscription.billing_interval,
        "currency": subscription.currency,
        "extra_users": subscription.extra_users or 0,
        "extra_sites": subscription.extra_sites or 0,
        "trial_ends_at": subscription.trial_ends_at.isoformat() if subscription.trial_ends_at else None,
        "current_period_start": subscription.current_period_start.isoformat() if subscription.current_period_start else None,
        "current_period_end": subscription.current_period_end.isoformat() if subscription.current_period_end else None,
        "cancel_at_period_end": bool(subscription.cancel_at_period_end),
        "cancelled_at": subscription.cancelled_at.isoformat() if subscription.cancelled_at else None,
        "grace_period_ends_at": subscription.grace_period_ends_at.isoformat() if subscription.grace_period_ends_at else None,
        "price_monthly": plan.price_monthly if plan else None,
        "price_yearly": plan.price_yearly if plan else None,
    }
