"""Registrazione pubblica, verifica email e recupero password.

Il router è **disattivato di default in produzione**: aprire la creazione di
tenant a chiunque è una decisione commerciale, non un effetto collaterale di un
deploy. Si accende con `SELF_SERVICE_SIGNUP_ENABLED=true`; in locale è già
attivo, così la funzione è provabile senza configurare nulla.

Sicurezza applicata (§7.3 del piano SaaS):
- rate limiting su tutti gli endpoint non autenticati;
- token monouso, con scadenza, conservati solo come hash SHA-256;
- **nessuna enumerazione**: registrazione e recupero password rispondono allo
  stesso modo per un indirizzo esistente e uno inesistente. Distinguere i due
  casi trasformerebbe questi endpoint in un oracolo che dice a un attaccante
  quali email hanno un account MaintAI;
- consensi registrati con versione, istante e IP.
"""

from __future__ import annotations

import hashlib
import logging
import os
import re
import secrets
import unicodedata
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.logger_db import db_info, db_warn
from backend.core.plans import TRIAL_PLAN_CODE, get_plan, self_serve_plan_codes
from backend.core.rate_limiter import limiter, _real_client_ip
from backend.core.security import (
    IS_PRODUCTION,
    PASSWORD_POLICY_MESSAGE,
    STRONG_PWD_REGEX,
    get_password_hash,
)
from backend.schemas.billing import (
    ForgotPasswordRequest,
    ResetPasswordRequest,
    SignupRequest,
    VerifyEmailRequest,
)
from backend.services.billing import subscription_service as subs
from backend.services.notifications.mailer import send_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/public", tags=["public"])

# Versione dei documenti accettati in registrazione. Cambiandola si sa quali
# clienti hanno accettato quale testo — che è tutto il punto di raccogliere un
# consenso.
TERMS_VERSION = os.getenv("TERMS_VERSION", "2026-08-01")
PRIVACY_VERSION = os.getenv("PRIVACY_VERSION", "2026-08-01")

TOKEN_TTL_HOURS_VERIFY = 48
TOKEN_TTL_HOURS_RESET = 2

PURPOSE_VERIFY = "email_verify"
PURPOSE_RESET = "password_reset"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def signup_enabled() -> bool:
    raw = os.getenv("SELF_SERVICE_SIGNUP_ENABLED", "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    # Default: attivo in sviluppo, spento in cloud finché non lo si accende.
    return not IS_PRODUCTION


def _expose_dev_tokens() -> bool:
    """In sviluppo il token torna nella risposta, così si prova senza SMTP.

    In produzione mai: equivarrebbe a consegnare a chiunque la chiave di
    verifica di un account appena creato.
    """
    return not IS_PRODUCTION


def _require_enabled() -> None:
    if not signup_enabled():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Registrazione self-service non attiva su questa installazione.",
        )


def _app_url() -> str:
    return os.getenv("APP_PUBLIC_URL", "http://localhost:3000").rstrip("/")


# ── Token monouso ────────────────────────────────────────────────────────────


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _issue_token(db: Session, user_id: int, tenant_id: int | None, purpose: str, ttl_hours: int) -> str:
    from backend.db.modelli import AuthToken

    # I token precedenti dello stesso scopo vengono invalidati: due link di
    # reset validi contemporaneamente raddoppiano la finestra di attacco senza
    # dare nulla in cambio all'utente.
    db.query(AuthToken).filter(
        AuthToken.user_id == user_id,
        AuthToken.purpose == purpose,
        AuthToken.used_at.is_(None),
    ).delete(synchronize_session=False)

    token = secrets.token_urlsafe(32)
    db.add(AuthToken(
        user_id=user_id,
        tenant_id=tenant_id,
        purpose=purpose,
        token_hash=_hash_token(token),
        expires_at=_utcnow() + timedelta(hours=ttl_hours),
    ))
    return token


def _consume_token(db: Session, token: str, purpose: str):
    """Valida e consuma un token. Ritorna l'utente, o None se non utilizzabile."""
    from backend.db.modelli import AuthToken, Utente

    row = (
        db.query(AuthToken)
        .filter(AuthToken.token_hash == _hash_token(token), AuthToken.purpose == purpose)
        .first()
    )
    if row is None or row.used_at is not None:
        return None

    expires_at = row.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at is not None and expires_at < _utcnow():
        return None

    row.used_at = _utcnow()
    return db.query(Utente).filter(Utente.id == row.user_id).first()


# ── Slug ─────────────────────────────────────────────────────────────────────


def _slugify(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    return slug[:40] or "cliente"


def _unique_slug(db: Session, base: str) -> str:
    from backend.db.modelli import Tenant

    slug = _slugify(base)
    if not db.query(Tenant).filter(Tenant.slug == slug).first():
        return slug
    # Suffisso casuale invece che progressivo: un contatore rivelerebbe quante
    # aziende con nome simile sono già registrate.
    for _ in range(10):
        candidate = f"{slug}-{secrets.token_hex(3)}"
        if not db.query(Tenant).filter(Tenant.slug == candidate).first():
            return candidate
    return f"{slug}-{secrets.token_hex(6)}"


# ── Endpoint ─────────────────────────────────────────────────────────────────


@router.get("/signup-status")
def signup_status():
    """Il frontend deve sapere se mostrare o meno il pulsante «Prova gratis»."""
    return {
        "enabled": signup_enabled(),
        "trial_days": int(os.getenv("TRIAL_DAYS", "14")),
        "terms_version": TERMS_VERSION,
        "privacy_version": PRIVACY_VERSION,
    }


@router.post("/signup", status_code=201)
@limiter.limit("5/hour")
def signup(request: Request, data: SignupRequest, db: Session = Depends(get_db)):
    """Crea azienda, amministratore e prova gratuita in un'unica transazione.

    Atomica per costruzione: un tenant senza amministratore sarebbe un account
    inaccessibile che nessuno può né usare né cancellare.
    """
    _require_enabled()
    from backend.db.modelli import Tenant, Utente

    client_ip = _real_client_ip(request)

    if not STRONG_PWD_REGEX.match(data.password):
        raise HTTPException(status_code=422, detail=PASSWORD_POLICY_MESSAGE)

    plan_code = data.plan_code if (data.plan_code and data.plan_code in self_serve_plan_codes()) else None
    trial_plan = get_plan(TRIAL_PLAN_CODE)

    existing = db.query(Utente).filter(Utente.username == data.email).first()
    if existing:
        # Risposta identica a quella di un successo. L'utente reale riceve
        # un'email che gli ricorda di avere già un account; chi sta sondando
        # indirizzi altrui non impara nulla.
        db_warn("SIGNUP", "Registrazione su email già esistente", {"ip": client_ip})
        send_email(
            to=data.email,
            subject="Hai già un account MaintAI",
            body=(
                f"Ciao,\n\nabbiamo ricevuto una richiesta di registrazione con questo indirizzo, "
                f"ma un account MaintAI esiste già.\n\n"
                f"Puoi accedere da {_app_url()}/login "
                f"oppure reimpostare la password da {_app_url()}/forgot-password\n\n"
                f"Se non sei stato tu, ignora questo messaggio.\n"
            ),
            category="signup_duplicate",
        )
        return _signup_response(None, trial_plan, dev_token=None)

    tenant = Tenant(
        nome=data.azienda.strip(),
        slug=_unique_slug(db, data.azienda),
        is_active=True,
        legal_name=data.azienda.strip(),
        vat_number=(data.vat_number or "").strip() or None,
        billing_email=data.email,
        country=data.paese,
        onboarding_status="pending",
    )
    db.add(tenant)
    db.flush()

    admin = Utente(
        username=data.email,
        email=data.email,
        password_hash=get_password_hash(data.password),
        ruolo="responsabile",
        tenant_id=tenant.id,
        is_tenant_owner=True,
    )
    db.add(admin)
    db.flush()

    subscription = subs.start_trial(db, tenant.id, plan_code=TRIAL_PLAN_CODE)
    if plan_code:
        # Il piano scelto in pagina prezzi si ricorda ma non si attiva: si attiva
        # pagando. Qui resta solo l'intenzione, che la UI userà per preselezionarlo.
        logger.info("signup: piano %s preselezionato dal tenant %s", plan_code, tenant.id)

    token = _issue_token(db, admin.id, tenant.id, PURPOSE_VERIFY, TOKEN_TTL_HOURS_VERIFY)

    db.commit()

    db_info("SIGNUP", f"Nuovo cliente registrato: {tenant.nome}", {
        "tenant_id": tenant.id,
        "slug": tenant.slug,
        "ip": client_ip,
        "terms_version": TERMS_VERSION,
        "privacy_version": PRIVACY_VERSION,
        "trial_ends_at": subscription.trial_ends_at.isoformat() if subscription.trial_ends_at else None,
    }, tenant_id=tenant.id)

    send_email(
        to=data.email,
        subject="Conferma il tuo indirizzo e attiva MaintAI",
        body=(
            f"Ciao {data.nome_referente},\n\n"
            f"l'area di {tenant.nome} è pronta. Conferma l'indirizzo per attivarla:\n\n"
            f"{_app_url()}/verify-email?token={token}\n\n"
            f"Il link è valido {TOKEN_TTL_HOURS_VERIFY} ore.\n"
            f"La prova gratuita dura {trial_plan.trial_days if trial_plan else 14} giorni e non richiede carta di credito.\n"
        ),
        category="signup_verify",
    )

    return _signup_response(tenant, trial_plan, dev_token=token if _expose_dev_tokens() else None)


def _signup_response(tenant, trial_plan, dev_token: str | None) -> dict:
    """Risposta volutamente identica nei due rami (nuovo account / già esistente)."""
    body = {
        "message": "Registrazione ricevuta. Controlla la posta per confermare l'indirizzo.",
        "trial_days": trial_plan.trial_days if trial_plan else 14,
        "tenant_slug": tenant.slug if tenant else None,
    }
    if dev_token:
        # Solo fuori produzione: rende la registrazione provabile senza SMTP.
        body["dev_verification_token"] = dev_token
        body["dev_verification_url"] = f"{_app_url()}/verify-email?token={dev_token}"
    return body


@router.post("/verify-email")
@limiter.limit("20/hour")
def verify_email(request: Request, data: VerifyEmailRequest, db: Session = Depends(get_db)):
    _require_enabled()
    user = _consume_token(db, data.token, PURPOSE_VERIFY)
    if user is None:
        # Nessun rollback: sul token non valido `_consume_token` esce prima di
        # scrivere. Un rollback qui butterebbe via anche eventuale lavoro
        # precedente della stessa transazione, senza avere nulla da annullare.
        raise HTTPException(status_code=400, detail="Link di verifica non valido o scaduto.")

    user.email_verified_at = _utcnow()
    db.commit()
    db_info("SIGNUP", f"Email verificata: {user.username}", {"tenant_id": user.tenant_id}, tenant_id=user.tenant_id)
    return {"ok": True, "message": "Indirizzo confermato. Puoi accedere.", "username": user.username}


@router.post("/resend-verification")
@limiter.limit("3/hour")
def resend_verification(request: Request, data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    _require_enabled()
    from backend.db.modelli import Utente

    user = db.query(Utente).filter(Utente.username == data.email).first()
    if user and user.email_verified_at is None:
        token = _issue_token(db, user.id, user.tenant_id, PURPOSE_VERIFY, TOKEN_TTL_HOURS_VERIFY)
        db.commit()
        send_email(
            to=data.email,
            subject="Conferma il tuo indirizzo MaintAI",
            body=f"Conferma l'indirizzo da qui:\n\n{_app_url()}/verify-email?token={token}\n",
            category="signup_verify_resend",
        )
    return {"ok": True, "message": "Se l'indirizzo richiede una conferma, riceverai una nuova email."}


@router.post("/forgot-password")
@limiter.limit("5/hour")
def forgot_password(request: Request, data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Avvia il recupero password. Risposta costante, per costruzione."""
    from backend.db.modelli import Utente

    token: str | None = None
    user = db.query(Utente).filter(Utente.username == data.email).first()
    if user and user.is_active:
        token = _issue_token(db, user.id, user.tenant_id, PURPOSE_RESET, TOKEN_TTL_HOURS_RESET)
        db.commit()
        send_email(
            to=data.email,
            subject="Reimposta la password MaintAI",
            body=(
                f"Hai chiesto di reimpostare la password.\n\n"
                f"{_app_url()}/reset-password?token={token}\n\n"
                f"Il link è valido {TOKEN_TTL_HOURS_RESET} ore e può essere usato una volta sola.\n"
                f"Se non sei stato tu, ignora questo messaggio: la password resta invariata.\n"
            ),
            category="password_reset",
        )
        db_info("AUTH", "Richiesta reset password", {"utente": user.username, "ip": _real_client_ip(request)})

    response = {"ok": True, "message": "Se l'indirizzo è registrato, riceverai le istruzioni via email."}
    if _expose_dev_tokens() and token:
        response["dev_reset_url"] = f"{_app_url()}/reset-password?token={token}"
    return response


@router.post("/reset-password")
@limiter.limit("10/hour")
def reset_password(request: Request, data: ResetPasswordRequest, db: Session = Depends(get_db)):
    if not STRONG_PWD_REGEX.match(data.new_password):
        raise HTTPException(status_code=422, detail=PASSWORD_POLICY_MESSAGE)

    user = _consume_token(db, data.token, PURPOSE_RESET)
    if user is None:
        raise HTTPException(status_code=400, detail="Link di reset non valido o scaduto.")

    user.password_hash = get_password_hash(data.new_password)
    # Invalida ogni sessione aperta: se la password è stata reimpostata perché
    # compromessa, lasciare vive le sessioni esistenti annullerebbe l'operazione.
    user.token_version = (user.token_version or 1) + 1
    db.commit()

    db_info("AUTH", f"Password reimpostata via token: {user.username}", {
        "tenant_id": user.tenant_id, "ip": _real_client_ip(request),
    }, tenant_id=user.tenant_id)
    return {"ok": True, "message": "Password aggiornata. Effettua l'accesso."}
