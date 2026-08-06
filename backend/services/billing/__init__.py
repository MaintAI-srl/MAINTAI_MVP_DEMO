"""Livello commerciale MaintAI: piani, abbonamenti, quote e provider di pagamento.

Regola di separazione (dal piano SaaS): la logica commerciale non vive nel
frontend. Il frontend mostra lo stato e guida l'utente; chi decide se
un'operazione è consentita è sempre il backend, qui dentro.
"""

from backend.services.billing.entitlement_service import (  # noqa: F401
    Entitlements,
    PlanLimitExceeded,
    SubscriptionInactive,
    resolve_entitlements,
    require_capacity,
    require_write_access,
    current_usage,
    usage_report,
)
from backend.services.billing.subscription_service import (  # noqa: F401
    ensure_subscription,
    start_trial,
    activate_plan,
    cancel_subscription,
    reactivate_subscription,
)
