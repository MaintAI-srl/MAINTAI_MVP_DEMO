"""Provider di pagamento — astrazione sopra Stripe, con un provider locale.

Perché due provider e non solo Stripe:

- il livello commerciale deve essere **provabile e testabile senza rete**. Con il
  solo Stripe, ogni test di quote, grace period e sola lettura richiederebbe una
  chiave, un tunnel per i webhook e un account di prova. Qui il provider locale
  simula il checkout e produce eventi con la stessa forma di quelli Stripe, che
  attraversano lo **stesso** codice di elaborazione: ciò che si verifica in
  locale è la strada che percorrerà anche il pagamento vero;
- non tutti i clienti passeranno dal checkout online. Un contratto firmato fuori
  piattaforma resta un abbonamento a tutti gli effetti: `provider="local"` è la
  sua rappresentazione onesta, non un caso degenere.

Sicurezza: MaintAI non vede né conserva dati di carta. Il checkout è ospitato
dal provider; qui passano solo identificativi.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Protocol

logger = logging.getLogger(__name__)


PROVIDER_LOCAL = "local"
PROVIDER_STRIPE = "stripe"


def app_public_url() -> str:
    return os.getenv("APP_PUBLIC_URL", "http://localhost:3000").rstrip("/")


def active_provider_name() -> str:
    """Provider in uso.

    Stripe si attiva solo se è configurato *davvero*: chiave presente e libreria
    installata. Un `BILLING_PROVIDER=stripe` senza chiave deve degradare al
    provider locale con un warning, non far esplodere il checkout in faccia a un
    cliente che sta cercando di pagare.
    """
    wanted = os.getenv("BILLING_PROVIDER", "").strip().lower()
    if wanted == PROVIDER_STRIPE or (not wanted and os.getenv("STRIPE_SECRET_KEY")):
        if _stripe_available():
            return PROVIDER_STRIPE
        logger.warning(
            "billing: provider stripe richiesto ma non configurato "
            "(STRIPE_SECRET_KEY assente o pacchetto 'stripe' non installato) — uso il provider locale"
        )
    return PROVIDER_LOCAL


def _stripe_available() -> bool:
    if not os.getenv("STRIPE_SECRET_KEY", "").strip():
        return False
    try:
        import stripe  # noqa: F401
    except ImportError:
        return False
    return True


@dataclass(frozen=True)
class CheckoutSession:
    url: str
    session_id: str
    provider: str
    # True quando il pagamento non è reale e va confermato dalla pagina di
    # simulazione: la UI deve dirlo chiaramente, mai fingere un incasso.
    simulated: bool = False


@dataclass(frozen=True)
class PortalSession:
    url: str
    provider: str
    simulated: bool = False


@dataclass(frozen=True)
class BillingEvent:
    """Evento di billing normalizzato — la forma che il resto del codice conosce.

    Volutamente modellata sui campi che servono a noi, non sulla struttura
    completa di Stripe: se un domani si aggiunge un secondo provider, l'adattatore
    riempie questi campi e nulla a valle cambia.
    """
    event_id: str
    event_type: str
    provider: str
    tenant_id: int | None
    plan_code: str | None
    billing_interval: str | None
    customer_id: str | None
    subscription_id: str | None
    status: str | None
    period_start: datetime | None
    period_end: datetime | None
    extra_users: int | None
    extra_sites: int | None
    payload_hash: str

    @staticmethod
    def hash_payload(payload: Any) -> str:
        raw = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()


class BillingProvider(Protocol):
    name: str

    def create_checkout_session(
        self, *, tenant_id: int, plan_code: str, billing_interval: str,
        customer_email: str | None, extra_users: int, extra_sites: int,
    ) -> CheckoutSession: ...

    def create_portal_session(self, *, tenant_id: int, customer_id: str | None) -> PortalSession: ...

    def parse_webhook(self, *, raw_body: bytes, signature: str | None) -> BillingEvent: ...


# ── Provider locale ──────────────────────────────────────────────────────────


class LocalBillingProvider:
    """Checkout simulato, senza rete e senza dati di pagamento.

    Il "token di checkout" è un JWT firmato con la chiave dell'applicazione e
    valido 30 minuti: contiene tenant, piano e quantità, quindi la pagina di
    simulazione non può inventarsi un piano diverso da quello scelto né attivare
    l'abbonamento di un altro tenant.
    """

    name = PROVIDER_LOCAL
    TOKEN_PURPOSE = "billing_checkout"
    TOKEN_TTL_MINUTES = 30

    def create_checkout_session(
        self, *, tenant_id: int, plan_code: str, billing_interval: str,
        customer_email: str | None, extra_users: int, extra_sites: int,
    ) -> CheckoutSession:
        from backend.core.security import create_access_token

        session_id = f"cs_local_{uuid.uuid4().hex[:24]}"
        token = create_access_token(
            data={
                "sub": f"checkout:{tenant_id}",
                "purpose": self.TOKEN_PURPOSE,
                "tenant_id": tenant_id,
                "plan_code": plan_code,
                "billing_interval": billing_interval,
                "extra_users": extra_users,
                "extra_sites": extra_sites,
                "session_id": session_id,
            },
            expires_delta=timedelta(minutes=self.TOKEN_TTL_MINUTES),
        )
        return CheckoutSession(
            url=f"{app_public_url()}/billing/checkout?token={token}",
            session_id=session_id,
            provider=self.name,
            simulated=True,
        )

    def create_portal_session(self, *, tenant_id: int, customer_id: str | None) -> PortalSession:
        return PortalSession(
            url=f"{app_public_url()}/settings/billing",
            provider=self.name,
            simulated=True,
        )

    def decode_checkout_token(self, token: str) -> dict:
        from fastapi import HTTPException

        from backend.core.security import decode_access_token

        payload = decode_access_token(token)
        if payload.get("purpose") != self.TOKEN_PURPOSE:
            raise HTTPException(status_code=400, detail="Token di checkout non valido")
        return payload

    def build_event_from_token(self, payload: dict) -> BillingEvent:
        """Trasforma un checkout simulato confermato in un evento di billing.

        Stessa forma di quello che arriverebbe da Stripe: da qui in poi il
        percorso è identico, webhook incluso.
        """
        now = datetime.now(timezone.utc)
        interval = payload.get("billing_interval", "monthly")
        body = {
            "session_id": payload.get("session_id"),
            "tenant_id": payload.get("tenant_id"),
            "plan_code": payload.get("plan_code"),
        }
        return BillingEvent(
            # L'event_id deriva dal session_id: due conferme dello stesso
            # checkout producono lo stesso id e la seconda viene scartata come
            # duplicato. È il test della logica di idempotenza, non un dettaglio.
            event_id=f"evt_local_{payload.get('session_id')}",
            event_type="checkout.session.completed",
            provider=self.name,
            tenant_id=int(payload["tenant_id"]),
            plan_code=payload.get("plan_code"),
            billing_interval=interval,
            customer_id=f"cus_local_{payload.get('tenant_id')}",
            subscription_id=f"sub_local_{payload.get('session_id')}",
            status="active",
            period_start=now,
            period_end=now + (timedelta(days=365) if interval == "yearly" else timedelta(days=30)),
            extra_users=int(payload.get("extra_users") or 0),
            extra_sites=int(payload.get("extra_sites") or 0),
            payload_hash=BillingEvent.hash_payload(body),
        )

    def parse_webhook(self, *, raw_body: bytes, signature: str | None) -> BillingEvent:
        """Webhook "manuale" del provider locale.

        Serve a provare gli eventi diversi dal checkout (pagamento fallito,
        disdetta dal provider, rinnovo) senza Stripe. Accetta il JSON grezzo:
        l'endpoint che la usa è protetto da un segreto condiviso e disponibile
        solo quando il provider attivo è quello locale.
        """
        payload = json.loads(raw_body.decode("utf-8"))
        return _event_from_generic_payload(payload, provider=self.name)


def _parse_ts(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _event_from_generic_payload(payload: dict, provider: str) -> BillingEvent:
    data = payload.get("data") or {}
    metadata = payload.get("metadata") or data.get("metadata") or {}
    return BillingEvent(
        event_id=str(payload.get("id") or f"evt_{provider}_{uuid.uuid4().hex[:20]}"),
        event_type=str(payload.get("type") or "unknown"),
        provider=provider,
        tenant_id=_as_int(metadata.get("tenant_id") or data.get("tenant_id")),
        plan_code=metadata.get("plan_code") or data.get("plan_code"),
        billing_interval=metadata.get("billing_interval") or data.get("billing_interval"),
        customer_id=data.get("customer") or data.get("customer_id"),
        subscription_id=data.get("subscription") or data.get("subscription_id") or data.get("id"),
        status=data.get("status"),
        period_start=_parse_ts(data.get("current_period_start")),
        period_end=_parse_ts(data.get("current_period_end")),
        extra_users=_as_int(metadata.get("extra_users")),
        extra_sites=_as_int(metadata.get("extra_sites")),
        payload_hash=BillingEvent.hash_payload(payload),
    )


# ── Provider Stripe ──────────────────────────────────────────────────────────


class StripeBillingProvider:
    """Adattatore Stripe Checkout + Customer Portal.

    Richiede il pacchetto `stripe` (non incluso di default nei requirements: si
    installa quando si accende il billing reale) e le variabili
    `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` e i price id per piano.

    Il `tenant_id` viaggia nei **metadata** della sessione: è l'unico modo per
    ricollegare in modo affidabile un pagamento al cliente giusto quando
    l'evento torna indietro dal provider.
    """

    name = PROVIDER_STRIPE

    def __init__(self) -> None:
        import stripe

        stripe.api_key = os.environ["STRIPE_SECRET_KEY"]
        self._stripe = stripe

    # -- price id -------------------------------------------------------------

    @staticmethod
    def price_id_for(plan_code: str, billing_interval: str) -> str:
        env_name = f"STRIPE_PRICE_{plan_code.upper()}_{billing_interval.upper()}"
        price_id = os.getenv(env_name, "").strip()
        if not price_id:
            raise RuntimeError(
                f"Price Stripe non configurato: manca la variabile d'ambiente {env_name}."
            )
        return price_id

    @staticmethod
    def addon_price_id(addon_code: str) -> str | None:
        return os.getenv(f"STRIPE_PRICE_{addon_code.upper()}_MONTHLY", "").strip() or None

    # -- checkout -------------------------------------------------------------

    def create_checkout_session(
        self, *, tenant_id: int, plan_code: str, billing_interval: str,
        customer_email: str | None, extra_users: int, extra_sites: int,
    ) -> CheckoutSession:
        line_items = [{"price": self.price_id_for(plan_code, billing_interval), "quantity": 1}]
        for addon_code, quantity in (("extra_user", extra_users), ("extra_site", extra_sites)):
            if quantity > 0:
                price_id = self.addon_price_id(addon_code)
                if price_id:
                    line_items.append({"price": price_id, "quantity": quantity})

        success_url = os.getenv("BILLING_SUCCESS_URL") or f"{app_public_url()}/settings/billing?checkout=success"
        cancel_url = os.getenv("BILLING_CANCEL_URL") or f"{app_public_url()}/pricing?checkout=cancelled"

        session = self._stripe.checkout.Session.create(
            mode="subscription",
            line_items=line_items,
            customer_email=customer_email or None,
            success_url=success_url,
            cancel_url=cancel_url,
            client_reference_id=str(tenant_id),
            metadata={
                "tenant_id": str(tenant_id),
                "plan_code": plan_code,
                "billing_interval": billing_interval,
                "extra_users": str(extra_users),
                "extra_sites": str(extra_sites),
            },
            subscription_data={
                "metadata": {
                    "tenant_id": str(tenant_id),
                    "plan_code": plan_code,
                    "billing_interval": billing_interval,
                }
            },
        )
        return CheckoutSession(url=session.url, session_id=session.id, provider=self.name)

    def create_portal_session(self, *, tenant_id: int, customer_id: str | None) -> PortalSession:
        if not customer_id:
            raise RuntimeError(
                "Nessun cliente Stripe associato a questo tenant: completare prima un pagamento."
            )
        session = self._stripe.billing_portal.Session.create(
            customer=customer_id,
            return_url=f"{app_public_url()}/settings/billing",
        )
        return PortalSession(url=session.url, provider=self.name)

    # -- webhook --------------------------------------------------------------

    def parse_webhook(self, *, raw_body: bytes, signature: str | None) -> BillingEvent:
        """Verifica la firma e normalizza l'evento.

        La verifica è **obbligatoria** e usa il corpo grezzo: un webhook non
        firmato è una richiesta anonima che sposta lo stato commerciale di un
        cliente. Niente firma valida, niente elaborazione.
        """
        webhook_secret = os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()
        if not webhook_secret:
            raise RuntimeError("STRIPE_WEBHOOK_SECRET non configurato: webhook rifiutato.")
        if not signature:
            raise ValueError("Header Stripe-Signature mancante")

        event = self._stripe.Webhook.construct_event(raw_body, signature, webhook_secret)
        return self._normalize(event)

    def _normalize(self, event: Any) -> BillingEvent:
        obj = event["data"]["object"]
        metadata = obj.get("metadata") or {}
        tenant_id = _as_int(metadata.get("tenant_id") or obj.get("client_reference_id"))

        # Su invoice.* i metadata stanno sulla subscription, non sulla fattura:
        # senza questo fallback i rinnovi non si ricollegherebbero a nessun tenant.
        subscription_id = obj.get("subscription") or (obj.get("id") if obj.get("object") == "subscription" else None)
        if tenant_id is None and subscription_id:
            try:
                sub = self._stripe.Subscription.retrieve(subscription_id)
                tenant_id = _as_int((sub.get("metadata") or {}).get("tenant_id"))
                metadata = sub.get("metadata") or metadata
            except Exception:
                logger.warning("stripe: impossibile risalire al tenant per subscription %s", subscription_id, exc_info=True)

        return BillingEvent(
            event_id=str(event["id"]),
            event_type=str(event["type"]),
            provider=self.name,
            tenant_id=tenant_id,
            plan_code=metadata.get("plan_code"),
            billing_interval=metadata.get("billing_interval"),
            customer_id=obj.get("customer"),
            subscription_id=subscription_id,
            status=obj.get("status"),
            period_start=_parse_ts(obj.get("current_period_start")),
            period_end=_parse_ts(obj.get("current_period_end")),
            extra_users=_as_int(metadata.get("extra_users")),
            extra_sites=_as_int(metadata.get("extra_sites")),
            payload_hash=BillingEvent.hash_payload(
                {"id": event["id"], "type": event["type"], "object_id": obj.get("id")}
            ),
        )


_local_provider = LocalBillingProvider()


def get_provider() -> BillingProvider:
    if active_provider_name() == PROVIDER_STRIPE:
        return StripeBillingProvider()
    return _local_provider


def get_local_provider() -> LocalBillingProvider:
    return _local_provider
