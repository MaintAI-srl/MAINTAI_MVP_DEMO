"""Endpoint del livello commerciale: piani, abbonamento, consumo, checkout, webhook.

Questo router è **core**: non passa dal gate dei moduli e non passa dal gate di
sola lettura. È deliberato. Un cliente il cui abbonamento è scaduto deve poter
raggiungere la pagina che gli permette di rimetterlo in regola; gatearla
significherebbe chiudere fuori proprio chi sta cercando di pagare.
"""

from __future__ import annotations

import logging
import os

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.logger_db import db_info, db_warn
from backend.core.plans import (
    ADDON_DEFINITIONS,
    addon_to_dict,
    get_plan,
    plan_to_dict,
    public_plans,
    self_serve_plan_codes,
)
from backend.core.rate_limiter import limiter
from backend.core.security import (
    get_current_tenant_id,
    get_current_user_payload,
    require_roles,
)
from backend.schemas.billing import (
    CancelRequest,
    ChangePlanRequest,
    ChangeQuantitiesRequest,
    CheckoutRequest,
    CompanyProfileUpdate,
)
from backend.services.billing import subscription_service as subs
from backend.services.billing.access_guard import invalidate_access_cache
from backend.services.billing.entitlement_service import resolve_entitlements, usage_report
from backend.services.billing.providers import (
    PROVIDER_LOCAL,
    active_provider_name,
    get_local_provider,
    get_provider,
)
from backend.services.billing.webhook_service import process_event

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing", tags=["billing"])


def _require_tenant(tenant_id: int | None) -> int:
    if tenant_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nessun cliente nel contesto: selezionare un tenant.",
        )
    return tenant_id


# ── Catalogo ─────────────────────────────────────────────────────────────────


@router.get("/plans")
def list_plans():
    """Catalogo pubblico. Nessuna autenticazione: alimenta anche la pagina prezzi."""
    return {
        "plans": [plan_to_dict(p) for p in public_plans()],
        "addons": [addon_to_dict(a) for a in ADDON_DEFINITIONS.values()],
        "provider": active_provider_name(),
        "trial_days": int(os.getenv("TRIAL_DAYS", "14")),
    }


# ── Stato dell'abbonamento ───────────────────────────────────────────────────


@router.get("/subscription")
def get_subscription(
    db: Session = Depends(get_db),
    tenant_id: int | None = Depends(get_current_tenant_id),
    _: dict = Depends(get_current_user_payload),
):
    """Stato commerciale del tenant corrente. Leggibile da qualunque ruolo.

    Anche un tecnico deve poter capire perché l'app è in sola lettura: nascondere
    lo stato produce solo ticket di supporto.
    """
    subscription = subs.get_subscription(db, tenant_id) if tenant_id else None
    entitlements = resolve_entitlements(db, tenant_id)
    return {
        "subscription": subs.subscription_to_dict(subscription),
        "entitlements": entitlements.to_dict(),
        "provider": active_provider_name(),
    }


@router.get("/usage")
def get_usage(
    db: Session = Depends(get_db),
    tenant_id: int | None = Depends(get_current_tenant_id),
    _: dict = Depends(get_current_user_payload),
):
    return usage_report(db, tenant_id)


# ── Checkout e portale ───────────────────────────────────────────────────────


@router.post("/checkout-session")
@limiter.limit("10/minute")
def create_checkout_session(
    request: Request,
    data: CheckoutRequest,
    db: Session = Depends(get_db),
    tenant_id: int | None = Depends(get_current_tenant_id),
    payload: dict = Depends(require_roles("responsabile")),
):
    """Apre una sessione di pagamento per il piano scelto.

    La validazione del piano avviene **qui**, non nel frontend: `plan_code`
    arriva dal client e senza controllo si potrebbe attivare un piano non
    vendibile (o l'enterprise a zero euro) semplicemente modificando la richiesta.
    """
    tid = _require_tenant(tenant_id)

    plan = get_plan(data.plan_code)
    if plan is None or plan.code not in self_serve_plan_codes():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Piano «{data.plan_code}» non acquistabile online.",
        )

    from backend.db.modelli import Utente

    user = db.query(Utente).filter(Utente.username == payload.get("sub")).first()
    customer_email = (user.email if user and user.email else None) or (user.username if user else None)

    provider = get_provider()
    session = provider.create_checkout_session(
        tenant_id=tid,
        plan_code=plan.code,
        billing_interval=data.billing_interval,
        customer_email=customer_email,
        extra_users=data.extra_users,
        extra_sites=data.extra_sites,
    )
    db_info("BILLING", f"Sessione di checkout aperta per il piano {plan.code}", {
        "tenant_id": tid, "provider": session.provider, "session_id": session.session_id,
    })
    return {
        "url": session.url,
        "session_id": session.session_id,
        "provider": session.provider,
        "simulated": session.simulated,
    }


@router.post("/customer-portal")
def create_customer_portal(
    db: Session = Depends(get_db),
    tenant_id: int | None = Depends(get_current_tenant_id),
    _: dict = Depends(require_roles("responsabile")),
):
    """Portale di gestione del provider (metodo di pagamento, fatture)."""
    tid = _require_tenant(tenant_id)
    subscription = subs.get_subscription(db, tid)
    provider = get_provider()
    try:
        session = provider.create_portal_session(
            tenant_id=tid,
            customer_id=subscription.provider_customer_id if subscription else None,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    return {"url": session.url, "provider": session.provider, "simulated": session.simulated}


@router.post("/simulate-checkout")
@limiter.limit("20/minute")
def simulate_checkout(request: Request, data: dict, db: Session = Depends(get_db)):
    """Conferma un checkout simulato (solo provider locale).

    Non è una scorciatoia di comodo: genera un evento con la stessa forma di
    quello di Stripe e lo fa passare per lo stesso `process_event`, vincolo di
    idempotenza incluso. Ciò che si prova qui è la strada del pagamento vero.

    Il token è firmato e contiene tenant e piano: la pagina di simulazione non
    può attivare un piano che l'utente non ha scelto, né toccare un altro tenant.
    """
    if active_provider_name() != PROVIDER_LOCAL:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Checkout simulato non disponibile: è attivo un provider di pagamento reale.",
        )

    token = (data or {}).get("token", "")
    if not token:
        raise HTTPException(status_code=422, detail="Token di checkout mancante")

    local = get_local_provider()
    claims = local.decode_checkout_token(token)
    event = local.build_event_from_token(claims)
    result = process_event(db, event)
    invalidate_access_cache(event.tenant_id)

    db_info("BILLING", f"Checkout simulato confermato ({result.status})", {
        "tenant_id": event.tenant_id, "plan_code": event.plan_code, "event_id": event.event_id,
    })
    return result.to_dict()


# ── Modifiche all'abbonamento ────────────────────────────────────────────────


@router.post("/change-plan")
def change_plan(
    data: ChangePlanRequest,
    db: Session = Depends(get_db),
    tenant_id: int | None = Depends(get_current_tenant_id),
    _: dict = Depends(require_roles("responsabile")),
):
    tid = _require_tenant(tenant_id)
    plan = get_plan(data.plan_code)
    if plan is None or plan.code not in self_serve_plan_codes():
        raise HTTPException(status_code=422, detail=f"Piano «{data.plan_code}» non disponibile.")

    subscription = subs.get_subscription(db, tid)
    if subscription and subscription.provider != PROVIDER_LOCAL:
        # Con un provider reale il cambio piano è una modifica della
        # subscription lato provider, che torna via webhook. Farlo qui creerebbe
        # una divergenza fra ciò che il cliente vede e ciò che gli viene
        # addebitato — il tipo di bug che si scopre dal commercialista.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Il cambio piano va effettuato dal portale di fatturazione.",
        )

    subs.change_plan(db, tid, plan.code, data.billing_interval)
    db.commit()
    invalidate_access_cache(tid)
    _invalidate_modules(tid)
    db_info("BILLING", f"Piano cambiato in {plan.code}", {"tenant_id": tid})
    return {"subscription": subs.subscription_to_dict(subs.get_subscription(db, tid))}


@router.post("/change-quantities")
def change_quantities(
    data: ChangeQuantitiesRequest,
    db: Session = Depends(get_db),
    tenant_id: int | None = Depends(get_current_tenant_id),
    _: dict = Depends(require_roles("responsabile")),
):
    tid = _require_tenant(tenant_id)
    subscription = subs.get_subscription(db, tid)
    if subscription and subscription.provider != PROVIDER_LOCAL:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Le licenze aggiuntive si modificano dal portale di fatturazione.",
        )
    try:
        subs.set_addon_quantities(db, tid, data.extra_users, data.extra_sites)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    db.commit()
    invalidate_access_cache(tid)
    return {"subscription": subs.subscription_to_dict(subs.get_subscription(db, tid))}


@router.post("/cancel")
def cancel(
    data: CancelRequest,
    db: Session = Depends(get_db),
    tenant_id: int | None = Depends(get_current_tenant_id),
    payload: dict = Depends(require_roles("responsabile")),
):
    """Disdetta autonoma. Nessuna email da mandare, nessuno da chiamare."""
    tid = _require_tenant(tenant_id)
    try:
        subs.cancel_subscription(db, tid, at_period_end=data.at_period_end, reason=data.reason)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    db.commit()
    invalidate_access_cache(tid)
    db_warn("BILLING", "Abbonamento disdetto dal cliente", {
        "tenant_id": tid, "utente": payload.get("sub"),
        "at_period_end": data.at_period_end, "motivo": data.reason,
    })
    return {"subscription": subs.subscription_to_dict(subs.get_subscription(db, tid))}


@router.post("/reactivate")
def reactivate(
    db: Session = Depends(get_db),
    tenant_id: int | None = Depends(get_current_tenant_id),
    _: dict = Depends(require_roles("responsabile")),
):
    tid = _require_tenant(tenant_id)
    try:
        subs.reactivate_subscription(db, tid)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    db.commit()
    invalidate_access_cache(tid)
    db_info("BILLING", "Abbonamento riattivato", {"tenant_id": tid})
    return {"subscription": subs.subscription_to_dict(subs.get_subscription(db, tid))}


# ── Anagrafica azienda ───────────────────────────────────────────────────────


@router.get("/company")
def get_company(
    db: Session = Depends(get_db),
    tenant_id: int | None = Depends(get_current_tenant_id),
    _: dict = Depends(require_roles("responsabile")),
):
    from backend.db.modelli import Tenant

    tid = _require_tenant(tenant_id)
    tenant = db.query(Tenant).filter(Tenant.id == tid).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Cliente non trovato")
    return {
        "nome": tenant.nome,
        "slug": tenant.slug,
        "legal_name": tenant.legal_name,
        "vat_number": tenant.vat_number,
        "billing_email": tenant.billing_email,
        "country": tenant.country,
        "onboarding_status": tenant.onboarding_status,
    }


@router.put("/company")
def update_company(
    data: CompanyProfileUpdate,
    db: Session = Depends(get_db),
    tenant_id: int | None = Depends(get_current_tenant_id),
    _: dict = Depends(require_roles("responsabile")),
):
    from backend.db.modelli import Tenant

    tid = _require_tenant(tenant_id)
    tenant = db.query(Tenant).filter(Tenant.id == tid).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Cliente non trovato")

    for field in ("nome", "legal_name", "vat_number", "billing_email"):
        value = getattr(data, field)
        if value is not None:
            setattr(tenant, field, value)
    if data.country is not None:
        tenant.country = data.country.upper()
    db.commit()
    return {"ok": True}


# ── Webhook ──────────────────────────────────────────────────────────────────


@router.post("/webhook")
async def billing_webhook(request: Request, response: Response, db: Session = Depends(get_db)):
    """Ricezione eventi dal provider di pagamento.

    Tre proprietà non negoziabili:

    1. **corpo grezzo** — la firma si calcola sui byte esatti; un JSON
       ri-serializzato da Pydantic non verificherebbe mai;
    2. **firma obbligatoria** — con Stripe la verifica è delegata alla libreria;
       con il provider locale serve il segreto condiviso `BILLING_WEBHOOK_SECRET`,
       altrimenti l'endpoint è chiuso;
    3. **200 anche sugli errori applicativi** — il provider ritenta finché non
       riceve un 2xx. Su un evento malformato il retry non aiuterebbe: si
       risponde 200 e si lascia la riga in `subscription_events` con stato
       `error`, che è la coda da riconciliare.
    """
    raw_body = await request.body()
    signature = request.headers.get("stripe-signature")
    provider_name = active_provider_name()

    if provider_name == PROVIDER_LOCAL:
        expected = os.getenv("BILLING_WEBHOOK_SECRET", "").strip()
        if not expected:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Webhook non configurato.",
            )
        import hmac

        provided = request.headers.get("x-billing-secret", "")
        if not hmac.compare_digest(provided, expected):
            db_warn("BILLING", "Webhook rifiutato: segreto non valido", {"ip": request.client.host if request.client else None})
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Firma non valida")

    provider = get_provider()
    try:
        event = provider.parse_webhook(raw_body=raw_body, signature=signature)
    except Exception as exc:
        # Firma non valida = richiesta ostile o configurazione errata: 400, e il
        # provider non deve ritentare qualcosa che non verificherà mai.
        db_warn("BILLING", f"Webhook non verificabile: {exc}", {"provider": provider_name})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Webhook non valido") from exc

    result = process_event(db, event)
    invalidate_access_cache(event.tenant_id)
    _invalidate_modules(event.tenant_id)

    if result.status == "error":
        response.status_code = status.HTTP_200_OK
    return result.to_dict()


def _invalidate_modules(tenant_id: int | None) -> None:
    """Un cambio di piano cambia i moduli concessi: la cache va buttata."""
    try:
        from backend.core.modules import invalidate_module_caches

        invalidate_module_caches()
    except Exception:
        logger.warning("billing: invalidazione cache moduli fallita", exc_info=True)
