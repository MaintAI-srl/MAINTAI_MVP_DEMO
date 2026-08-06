"""Entitlement service — l'unico punto che decide *cosa può fare* un tenant.

Tre domande, una sola risposta autoritativa ciascuna:

1. **Che piano ha?**            → `resolve_entitlements()`
2. **Può scrivere?**            → `require_write_access()`
3. **Ha ancora capienza?**      → `require_capacity()`

Il frontend può (e deve) mostrare in anticipo lo stato per non far compilare
form destinati a fallire, ma non è lui a decidere: ogni endpoint che crea una
risorsa a quota passa comunque di qui. È la regola §4.2 del piano SaaS.

**Retrocompatibilità.** Un tenant senza riga in `subscriptions` — cioè tutti
quelli creati a mano dal superadmin prima di questo livello — è *grandfathered*:
accesso pieno, nessun limite. Il livello commerciale si attiva sottoscrivendo,
non si subisce per omissione. Vietato fail-closed qui: chiuderebbe fuori i
clienti esistenti al primo deploy.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from backend.core.plans import (
    ADDON_DEFINITIONS,
    ALL_METRICS,
    FLOW_METRICS,
    METRIC_AI_CALLS,
    METRIC_ASSETS,
    METRIC_LABELS,
    METRIC_SITES,
    METRIC_USERS,
    STOCK_METRICS,
    UNLIMITED,
    PlanDefinition,
    get_plan,
    is_unlimited,
)

logger = logging.getLogger(__name__)


# ── Accesso ──────────────────────────────────────────────────────────────────

ACCESS_FULL = "full"
ACCESS_READ_ONLY = "read_only"

# Stati in cui l'abbonamento è "in regola".
ACTIVE_STATUSES = {"trialing", "active"}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime | None) -> datetime | None:
    """Normalizza a UTC-aware.

    SQLite riconsegna i DateTime senza tzinfo anche se sono stati scritti aware:
    confrontarli con `datetime.now(timezone.utc)` solleverebbe TypeError. Con
    PostgreSQL il problema non si presenta, quindi sarebbe un errore che compare
    solo in locale o solo in cloud a seconda di come lo si scrive.
    """
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _grace_days() -> int:
    try:
        return max(0, int(os.getenv("BILLING_GRACE_DAYS", "7")))
    except ValueError:
        return 7


# ── Errori tipizzati ─────────────────────────────────────────────────────────


class PlanLimitExceeded(HTTPException):
    """402: quota del piano esaurita.

    Il corpo è strutturato apposta perché la UI possa dire *cosa* manca e
    *quanto* — non "operazione non consentita" — e offrire l'upgrade senza far
    perdere all'utente quello che aveva già scritto nel form.
    """

    def __init__(self, metric: str, current: int, limit: int, plan_code: str):
        super().__init__(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "plan_limit_reached",
                "metric": metric,
                "metric_label": METRIC_LABELS.get(metric, metric),
                "current": current,
                "limit": limit,
                "plan_code": plan_code,
                "upgrade_url": "/settings/billing",
                "message": (
                    f"Limite del piano raggiunto per «{METRIC_LABELS.get(metric, metric)}»: "
                    f"{current}/{limit}. Aumenta il piano o acquista licenze aggiuntive."
                ),
            },
        )


class SubscriptionInactive(HTTPException):
    """402: abbonamento non in regola → l'app resta leggibile ma non scrivibile.

    Sola lettura, mai blocco totale: il cliente deve poter rientrare, scaricare
    le fatture ed esportare i propri dati anche quando non ha pagato. Un
    lucchetto sui dati altrui è un ricatto, non un incentivo al pagamento.
    """

    def __init__(self, reason: str, message: str, status_value: str):
        super().__init__(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "subscription_inactive",
                "reason": reason,
                "subscription_status": status_value,
                "upgrade_url": "/settings/billing",
                "message": message,
            },
        )


# ── Entitlements ─────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Entitlements:
    tenant_id: int | None
    plan: PlanDefinition | None
    plan_code: str
    status: str
    access_level: str
    reason: str | None
    limits: dict[str, int]
    trial_ends_at: datetime | None = None
    current_period_end: datetime | None = None
    grace_period_ends_at: datetime | None = None
    cancel_at_period_end: bool = False
    # True quando il tenant non ha abbonamento: nessun limite, nessun gate.
    grandfathered: bool = False
    warnings: list[str] = field(default_factory=list)

    @property
    def can_write(self) -> bool:
        return self.access_level == ACCESS_FULL

    def limit_for(self, metric: str) -> int:
        return self.limits.get(metric, UNLIMITED)

    def allowed_module_ids(self) -> frozenset[str] | None:
        """Moduli concessi dal piano. `None` = nessuna restrizione commerciale."""
        if self.grandfathered or self.plan is None or self.plan.modules is None:
            return None
        return frozenset(self.plan.modules)

    def to_dict(self) -> dict:
        return {
            "tenant_id": self.tenant_id,
            "plan_code": self.plan_code,
            "plan_name": self.plan.name if self.plan else "Senza abbonamento",
            "status": self.status,
            "access_level": self.access_level,
            "reason": self.reason,
            "limits": dict(self.limits),
            "trial_ends_at": self.trial_ends_at.isoformat() if self.trial_ends_at else None,
            "current_period_end": self.current_period_end.isoformat() if self.current_period_end else None,
            "grace_period_ends_at": self.grace_period_ends_at.isoformat() if self.grace_period_ends_at else None,
            "cancel_at_period_end": self.cancel_at_period_end,
            "grandfathered": self.grandfathered,
            "warnings": list(self.warnings),
        }


GRANDFATHERED = Entitlements(
    tenant_id=None,
    plan=None,
    plan_code="unmanaged",
    status="unmanaged",
    access_level=ACCESS_FULL,
    reason=None,
    limits={metric: UNLIMITED for metric in ALL_METRICS},
    grandfathered=True,
)


def get_subscription(db: Session, tenant_id: int | None):
    """Riga `subscriptions` del tenant, o None.

    Non solleva mai: se la tabella non è ancora migrata (deploy in corso, DB
    demo non allineato) il livello commerciale si comporta come assente, che è
    esattamente il comportamento pre-esistente.
    """
    if tenant_id is None:
        return None
    from backend.db.modelli import Subscription

    try:
        return db.query(Subscription).filter(Subscription.tenant_id == tenant_id).first()
    except Exception:
        logger.warning("entitlement: tabella subscriptions non leggibile — tenant trattato come grandfathered", exc_info=True)
        return None


def resolve_entitlements(db: Session, tenant_id: int | None) -> Entitlements:
    """Stato commerciale effettivo del tenant, comprensivo di limiti e accesso."""
    subscription = get_subscription(db, tenant_id)
    if subscription is None:
        return Entitlements(
            tenant_id=tenant_id,
            plan=GRANDFATHERED.plan,
            plan_code=GRANDFATHERED.plan_code,
            status=GRANDFATHERED.status,
            access_level=ACCESS_FULL,
            reason=None,
            limits=dict(GRANDFATHERED.limits),
            grandfathered=True,
        )

    plan = get_plan(subscription.plan_code)
    if plan is None:
        # Piano rimosso dal catalogo ma ancora sottoscritto da qualcuno: non si
        # chiude fuori il cliente per una nostra modifica di listino.
        logger.error(
            "entitlement: piano %r sconosciuto per tenant %s — accesso mantenuto senza limiti",
            subscription.plan_code, tenant_id,
        )
        return Entitlements(
            tenant_id=tenant_id,
            plan=None,
            plan_code=subscription.plan_code,
            status=subscription.status,
            access_level=ACCESS_FULL,
            reason=None,
            limits={metric: UNLIMITED for metric in ALL_METRICS},
            grandfathered=True,
            warnings=[f"Piano «{subscription.plan_code}» non presente nel catalogo."],
        )

    limits = _limits_for(plan, subscription)
    access_level, reason, warnings = _resolve_access(subscription)

    return Entitlements(
        tenant_id=tenant_id,
        plan=plan,
        plan_code=plan.code,
        status=subscription.status,
        access_level=access_level,
        reason=reason,
        limits=limits,
        trial_ends_at=_aware(subscription.trial_ends_at),
        current_period_end=_aware(subscription.current_period_end),
        grace_period_ends_at=_aware(subscription.grace_period_ends_at),
        cancel_at_period_end=bool(subscription.cancel_at_period_end),
        warnings=warnings,
    )


def _limits_for(plan: PlanDefinition, subscription) -> dict[str, int]:
    """Quote del piano più gli add-on acquistati."""
    limits: dict[str, int] = {}
    extra = {
        METRIC_USERS: (subscription.extra_users or 0) * ADDON_DEFINITIONS["extra_user"].grants,
        METRIC_SITES: (subscription.extra_sites or 0) * ADDON_DEFINITIONS["extra_site"].grants,
    }
    for metric in ALL_METRICS:
        base = plan.limit_for(metric)
        if is_unlimited(base):
            limits[metric] = UNLIMITED
        else:
            limits[metric] = base + extra.get(metric, 0)
    return limits


def _resolve_access(subscription) -> tuple[str, str | None, list[str]]:
    """Traduce lo stato dell'abbonamento in livello di accesso.

    Politica (§6.6 del piano SaaS), con una scelta esplicita: **nessuno stato
    porta al blocco totale**. Il peggio è la sola lettura, che lascia intatti
    export, fatture e aggiornamento del metodo di pagamento.
    """
    now = _utcnow()
    state = (subscription.status or "").lower()
    warnings: list[str] = []

    if state == "trialing":
        trial_end = _aware(subscription.trial_ends_at)
        if trial_end and now > trial_end:
            return ACCESS_READ_ONLY, "trial_expired", warnings
        if trial_end:
            days_left = (trial_end - now).days
            if days_left <= 3:
                warnings.append(f"La prova gratuita termina fra {max(days_left, 0)} giorni.")
        return ACCESS_FULL, None, warnings

    if state == "active":
        if subscription.cancel_at_period_end:
            warnings.append("Abbonamento disdetto: resterà attivo fino alla fine del periodo pagato.")
        period_end = _aware(subscription.current_period_end)
        if period_end and now > period_end:
            # Periodo scaduto senza rinnovo confermato dal provider: quasi
            # sempre un webhook perso. Si degrada, ma senza silenzio.
            logger.warning(
                "entitlement: abbonamento %s 'active' con periodo scaduto il %s — possibile webhook perso",
                subscription.id, period_end,
            )
            return ACCESS_READ_ONLY, "period_ended", warnings
        return ACCESS_FULL, None, warnings

    if state == "past_due":
        grace_end = _aware(subscription.grace_period_ends_at)
        if grace_end is None:
            grace_end = now + timedelta(days=_grace_days())
        if now <= grace_end:
            warnings.append(
                "Ultimo pagamento non riuscito. Aggiorna il metodo di pagamento per non perdere l'accesso."
            )
            return ACCESS_FULL, "past_due_grace", warnings
        return ACCESS_READ_ONLY, "past_due_expired", warnings

    if state in ("unpaid", "paused", "incomplete", "incomplete_expired"):
        return ACCESS_READ_ONLY, state, warnings

    if state == "cancelled":
        period_end = _aware(subscription.current_period_end)
        if period_end and now <= period_end:
            warnings.append("Abbonamento disdetto: accesso completo fino alla fine del periodo pagato.")
            return ACCESS_FULL, "cancelled_until_period_end", warnings
        return ACCESS_READ_ONLY, "cancelled", warnings

    logger.warning("entitlement: stato abbonamento non riconosciuto %r — trattato come sola lettura", state)
    return ACCESS_READ_ONLY, "unknown_status", warnings


# ── Misura del consumo ───────────────────────────────────────────────────────


def _count_stock(db: Session, tenant_id: int, metric: str) -> int:
    from backend.db.modelli import Asset, Sito, Utente

    if metric == METRIC_USERS:
        return db.query(Utente).filter(
            Utente.tenant_id == tenant_id, Utente.is_active.is_(True)
        ).count()
    if metric == METRIC_SITES:
        return db.query(Sito).filter(Sito.tenant_id == tenant_id).count()
    if metric == METRIC_ASSETS:
        return db.query(Asset).filter(Asset.tenant_id == tenant_id).count()
    return 0


def current_period_bounds(reference: datetime | None = None) -> tuple[datetime, datetime]:
    """Mese solare corrente, in UTC. Periodo di riferimento delle metriche di flusso."""
    now = reference or _utcnow()
    start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start, end


def _count_flow(db: Session, tenant_id: int, metric: str) -> int:
    from backend.db.modelli import UsageCounter

    period_start, _ = current_period_bounds()
    row = (
        db.query(UsageCounter)
        .filter(
            UsageCounter.tenant_id == tenant_id,
            UsageCounter.metric_code == metric,
            UsageCounter.period_start == period_start,
        )
        .first()
    )
    return int(row.used_value) if row else 0


def current_usage(db: Session, tenant_id: int | None, metric: str) -> int:
    if tenant_id is None or metric not in ALL_METRICS:
        return 0
    try:
        if metric in STOCK_METRICS:
            return _count_stock(db, tenant_id, metric)
        return _count_flow(db, tenant_id, metric)
    except Exception:
        logger.warning("entitlement: misura consumo fallita per %s/%s", tenant_id, metric, exc_info=True)
        return 0


def record_usage(db: Session, tenant_id: int | None, metric: str, increment: int = 1) -> int:
    """Incrementa una metrica di flusso nel periodo corrente. Ritorna il nuovo totale.

    Non fa commit: chi chiama decide la transazione, così il consumo si annulla
    insieme all'operazione che lo ha generato se questa fallisce.
    """
    if tenant_id is None or metric not in FLOW_METRICS or increment == 0:
        return 0
    from backend.db.modelli import UsageCounter

    period_start, period_end = current_period_bounds()
    row = (
        db.query(UsageCounter)
        .filter(
            UsageCounter.tenant_id == tenant_id,
            UsageCounter.metric_code == metric,
            UsageCounter.period_start == period_start,
        )
        .first()
    )
    if row is None:
        row = UsageCounter(
            tenant_id=tenant_id,
            metric_code=metric,
            period_start=period_start,
            period_end=period_end,
            used_value=0,
        )
        db.add(row)
        db.flush()
    row.used_value = int(row.used_value or 0) + increment
    return int(row.used_value)


# ── Gate ─────────────────────────────────────────────────────────────────────


def require_write_access(db: Session, tenant_id: int | None) -> Entitlements:
    """Blocca le operazioni di scrittura se l'abbonamento non è in regola."""
    ent = resolve_entitlements(db, tenant_id)
    if ent.can_write:
        return ent

    messages = {
        "trial_expired": "La prova gratuita è terminata. Scegli un piano per riprendere a lavorare.",
        "past_due_expired": "Il pagamento non è andato a buon fine. Aggiorna il metodo di pagamento per riattivare l'account.",
        "period_ended": "Il periodo di abbonamento è scaduto. Rinnova per riprendere a lavorare.",
        "cancelled": "L'abbonamento è stato disdetto. Riattivalo per riprendere a lavorare.",
        "unpaid": "Ci sono fatture non saldate. Regolarizza il pagamento per riprendere a lavorare.",
        "paused": "L'abbonamento è sospeso. Riattivalo per riprendere a lavorare.",
    }
    reason = ent.reason or ent.status
    raise SubscriptionInactive(
        reason=reason,
        message=messages.get(
            reason,
            "L'abbonamento non è attivo. L'account resta consultabile ed esportabile in sola lettura.",
        ),
        status_value=ent.status,
    )


def require_capacity(
    db: Session,
    tenant_id: int | None,
    metric: str,
    increment: int = 1,
    entitlements: Entitlements | None = None,
) -> Entitlements:
    """Verifica che ci sia capienza per `increment` unità della metrica.

    Da chiamare **prima** di creare la risorsa: se scatta, l'endpoint non deve
    aver ancora scritto nulla.
    """
    ent = entitlements or resolve_entitlements(db, tenant_id)
    if ent.grandfathered or tenant_id is None:
        return ent

    limit = ent.limit_for(metric)
    if is_unlimited(limit):
        return ent

    used = current_usage(db, tenant_id, metric)
    if used + increment > limit:
        raise PlanLimitExceeded(metric=metric, current=used, limit=limit, plan_code=ent.plan_code)
    return ent


def require_capacity_and_write(db: Session, tenant_id: int | None, metric: str, increment: int = 1) -> Entitlements:
    """Le due verifiche insieme, nell'ordine giusto: prima si può scrivere, poi c'è posto."""
    ent = require_write_access(db, tenant_id)
    return require_capacity(db, tenant_id, metric, increment, entitlements=ent)


def consume_ai_call(db: Session, tenant_id: int | None, increment: int = 1) -> None:
    """Verifica e registra il consumo di una chiamata AI.

    Separata da `require_capacity` perché le metriche di flusso vanno anche
    *incrementate*: verificare senza registrare renderebbe il limite decorativo.
    """
    if tenant_id is None:
        return
    require_capacity(db, tenant_id, METRIC_AI_CALLS, increment)
    record_usage(db, tenant_id, METRIC_AI_CALLS, increment)


def usage_report(db: Session, tenant_id: int | None) -> dict:
    """Consumo corrente su tutte le metriche — alimenta la pagina Abbonamento."""
    ent = resolve_entitlements(db, tenant_id)
    metrics = []
    for metric in ALL_METRICS:
        limit = ent.limit_for(metric)
        used = current_usage(db, tenant_id, metric)
        metrics.append({
            "metric": metric,
            "label": METRIC_LABELS.get(metric, metric),
            "used": used,
            "limit": None if is_unlimited(limit) else limit,
            "unlimited": is_unlimited(limit),
            "percent": None if is_unlimited(limit) or limit == 0 else min(100, round(used * 100 / limit)),
            "addons": [a.code for a in ADDON_DEFINITIONS.values() if a.metric == metric],
        })
    return {"entitlements": ent.to_dict(), "metrics": metrics}
