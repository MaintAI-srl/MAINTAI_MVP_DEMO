"""Elaborazione idempotente degli eventi di billing.

Il problema che questo modulo risolve non è "leggere un webhook", è **riceverlo
due volte**. Stripe garantisce *at-least-once*: ritenta finché non riceve un 2xx,
e una risposta persa in rete produce una seconda consegna dello stesso evento.
Senza difesa, un `invoice.paid` consegnato due volte sposta il periodo di
fatturazione due volte e il cliente si ritrova un mese regalato — o, con
`customer.subscription.deleted`, un tenant chiuso due volte e riaperto male.

La difesa è il vincolo UNIQUE su `subscription_events.provider_event_id`: la
seconda consegna fallisce l'INSERT e diventa un no-op. È il database a fare da
lock, non una variabile in memoria che sopravvive a un solo processo.

Ordine di scrittura (importante): **prima** si registra l'evento e si committa,
**poi** si applicano gli effetti. Al contrario, un crash fra effetto e
registrazione produrrebbe un evento riapplicabile.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.core.plans import DEFAULT_PLAN_CODE, get_plan
from backend.services.billing import subscription_service as subs
from backend.services.billing.providers import BillingEvent

logger = logging.getLogger(__name__)


# Eventi che sappiamo trattare. Gli altri si registrano come "ignored":
# tenerne traccia costa una riga ed evita la domanda "ma è arrivato?".
HANDLED_EVENT_TYPES = {
    "checkout.session.completed",
    "customer.subscription.created",
    "customer.subscription.updated",
    "customer.subscription.deleted",
    "invoice.paid",
    "invoice.payment_succeeded",
    "invoice.payment_failed",
    "invoice.payment_action_required",
    "customer.updated",
}


class WebhookResult:
    def __init__(self, status: str, detail: str = "", event_id: str | None = None):
        self.status = status  # processed | duplicate | ignored | error
        self.detail = detail
        self.event_id = event_id

    def to_dict(self) -> dict:
        return {"status": self.status, "detail": self.detail, "event_id": self.event_id}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _register_event(db: Session, event: BillingEvent):
    """Registra l'evento. Ritorna None se era già stato ricevuto.

    Il duplicato si riconosce dall'IntegrityError sul vincolo UNIQUE, non da una
    SELECT preventiva: fra la SELECT e l'INSERT ci sta comodamente una seconda
    consegna in parallelo, ed è esattamente il caso che si vuole coprire.
    """
    from backend.db.modelli import SubscriptionEvent

    row = SubscriptionEvent(
        tenant_id=event.tenant_id,
        provider=event.provider,
        provider_event_id=event.event_id,
        event_type=event.event_type,
        payload_hash=event.payload_hash,
        processing_status="received",
    )
    # SAVEPOINT invece di commit-and-rollback: sul duplicato si annulla soltanto
    # questo INSERT. Un `db.rollback()` butterebbe via l'intera transazione della
    # richiesta, compreso ciò che vi era già stato scritto.
    try:
        with db.begin_nested():
            db.add(row)
            db.flush()
        db.commit()
    except IntegrityError:
        existing = (
            db.query(SubscriptionEvent)
            .filter(SubscriptionEvent.provider_event_id == event.event_id)
            .first()
        )
        if existing and existing.payload_hash and event.payload_hash and existing.payload_hash != event.payload_hash:
            # Stesso identificativo, contenuto diverso: o il provider ha
            # cambiato il payload, o qualcuno sta rigiocando un event_id.
            # In entrambi i casi non si applica nulla, ma si lascia traccia.
            logger.error(
                "billing webhook: event_id %s già visto con payload diverso (replay?)",
                event.event_id,
            )
        # Chiude la transazione: sul duplicato non c'è più nulla da scrivere, e
        # tenerla aperta lascia in piedi un lock di scrittura che su SQLite
        # blocca la scrittura del log di sistema (che usa una sessione propria).
        db.commit()
        return None
    db.refresh(row)
    return row


def process_event(db: Session, event: BillingEvent) -> WebhookResult:
    """Applica un evento di billing, una volta sola."""
    row = _register_event(db, event)
    if row is None:
        logger.info("billing webhook: evento %s duplicato, ignorato", event.event_id)
        return WebhookResult("duplicate", "Evento già elaborato", event.event_id)

    if event.event_type not in HANDLED_EVENT_TYPES:
        row.processing_status = "ignored"
        row.processed_at = _utcnow()
        db.commit()
        return WebhookResult("ignored", f"Tipo evento non gestito: {event.event_type}", event.event_id)

    if event.tenant_id is None:
        row.processing_status = "error"
        row.error_message = "Evento senza tenant_id nei metadata"
        row.processed_at = _utcnow()
        db.commit()
        logger.error("billing webhook: evento %s senza tenant_id — impossibile applicarlo", event.event_id)
        return WebhookResult("error", "Evento senza tenant_id", event.event_id)

    try:
        # Anche gli effetti stanno in un SAVEPOINT: se l'applicazione fallisce a
        # metà, l'abbonamento torna com'era ma la riga dell'evento — già
        # committata sopra — resta, con lo stato di errore.
        with db.begin_nested():
            _apply(db, event)
        subscription = subs.get_subscription(db, event.tenant_id)
        row.subscription_id = subscription.id if subscription else None
        row.processing_status = "processed"
        row.processed_at = _utcnow()
        db.commit()
        logger.info(
            "billing webhook: %s applicato al tenant %s", event.event_type, event.tenant_id
        )
        return WebhookResult("processed", f"{event.event_type} applicato", event.event_id)
    except Exception as exc:
        # L'evento resta registrato con lo stato di errore: la riga è la coda di
        # riconciliazione, e senza di essa un fallimento sparirebbe nei log.
        row.processing_status = "error"
        row.error_message = str(exc)[:1000]
        row.processed_at = _utcnow()
        db.commit()
        logger.exception("billing webhook: errore applicando %s", event.event_id)
        return WebhookResult("error", str(exc), event.event_id)


def _apply(db: Session, event: BillingEvent) -> None:
    tenant_id = event.tenant_id
    etype = event.event_type

    if etype in ("checkout.session.completed", "customer.subscription.created"):
        plan_code = event.plan_code if get_plan(event.plan_code) else DEFAULT_PLAN_CODE
        subs.activate_plan(
            db, tenant_id,
            plan_code=plan_code,
            billing_interval=event.billing_interval or "monthly",
            provider=event.provider,
            provider_customer_id=event.customer_id,
            provider_subscription_id=event.subscription_id,
            extra_users=event.extra_users,
            extra_sites=event.extra_sites,
            period_start=event.period_start,
            period_end=event.period_end,
        )
        return

    if etype == "customer.subscription.updated":
        _apply_subscription_update(db, event)
        return

    if etype == "customer.subscription.deleted":
        subs.cancel_subscription(db, tenant_id, at_period_end=False, reason="provider:subscription.deleted")
        return

    if etype in ("invoice.paid", "invoice.payment_succeeded"):
        subs.renew_period(db, tenant_id, period_start=event.period_start, period_end=event.period_end)
        return

    if etype == "invoice.payment_failed":
        subs.mark_past_due(db, tenant_id)
        return

    if etype == "invoice.payment_action_required":
        # SCA: il pagamento non è fallito, richiede un'azione del cliente.
        # Trattato come morosità *con tolleranza*, non come mancato pagamento:
        # l'accesso resta pieno e il banner spiega cosa fare.
        subs.mark_past_due(db, tenant_id)
        return

    if etype == "customer.updated":
        subscription = subs.get_subscription(db, tenant_id)
        if subscription and event.customer_id:
            subscription.provider_customer_id = event.customer_id
            db.flush()
        return


def _apply_subscription_update(db: Session, event: BillingEvent) -> None:
    """Riallinea lo specchio locale allo stato del provider.

    Qui il provider è autoritativo: se dice `past_due`, è `past_due`, anche se
    lo stato locale diceva altro. Il ruolo di MaintAI è rispecchiare, non
    negoziare.
    """
    subscription = subs.get_subscription(db, event.tenant_id)
    if subscription is None:
        subs.activate_plan(
            db, event.tenant_id,
            plan_code=event.plan_code if get_plan(event.plan_code) else DEFAULT_PLAN_CODE,
            billing_interval=event.billing_interval or "monthly",
            provider=event.provider,
            provider_customer_id=event.customer_id,
            provider_subscription_id=event.subscription_id,
            period_start=event.period_start,
            period_end=event.period_end,
        )
        return

    if event.plan_code and get_plan(event.plan_code):
        subscription.plan_code = event.plan_code
    if event.billing_interval in ("monthly", "yearly"):
        subscription.billing_interval = event.billing_interval
    if event.customer_id:
        subscription.provider_customer_id = event.customer_id
    if event.subscription_id:
        subscription.provider_subscription_id = event.subscription_id
    if event.extra_users is not None:
        subscription.extra_users = max(0, event.extra_users)
    if event.extra_sites is not None:
        subscription.extra_sites = max(0, event.extra_sites)
    if event.period_start:
        subscription.current_period_start = event.period_start
    if event.period_end:
        subscription.current_period_end = event.period_end

    if event.status:
        status = event.status.lower()
        # Stripe usa "canceled" (una L), il modello dati qui usa "cancelled".
        subscription.status = "cancelled" if status in ("canceled", "cancelled") else status
        if status == "past_due" and not subscription.grace_period_ends_at:
            subs.mark_past_due(db, event.tenant_id)

    db.flush()
