from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload
from backend.core.dependencies import get_db
from backend.db.modelli import Utente
from backend.core.security import (
    verify_password, get_password_hash, create_access_token,
    ACCESS_TOKEN_EXPIRE_MINUTES, get_current_user_payload,
    COOKIE_NAME, COOKIE_MAX_AGE, COOKIE_SECURE, COOKIE_SAMESITE,
    STRONG_PWD_REGEX, PASSWORD_POLICY_MESSAGE, IS_PRODUCTION,
)
from backend.core.rate_limiter import limiter, _real_client_ip
from backend.core.logger_db import db_info, db_warn
from backend.services.security_monitor import record_failed_login, record_successful_login

router = APIRouter(prefix="/auth", tags=["auth"])

# Origin del WebView Tauri (desktop). Il client web usa SOLO il cookie HttpOnly;
# il token nel body JSON serve unicamente ai client nativi, che non hanno cookie.
_TAURI_ORIGINS = {"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"}


def _is_desktop_client(request: Request) -> bool:
    """True se il login arriva dal client desktop Tauri (o lo dichiara via header).

    Il token va nel body SOLO per questi client: per il web resta esclusivamente
    nel cookie HttpOnly (il token in body finirebbe esposto a XSS/localStorage).
    Fuori produzione il token è sempre incluso (sviluppo desktop su localhost).
    """
    origin = request.headers.get("origin", "")
    if origin in _TAURI_ORIGINS:
        return True
    if request.headers.get("x-client", "").strip().lower() == "desktop":
        return True
    return not IS_PRODUCTION

@router.post("/login")
@limiter.limit("5/minute")
def login(request: Request, response: Response, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    client_ip = _real_client_ip(request)

    user = (
        db.query(Utente)
        .options(joinedload(Utente.tenant))
        .filter(Utente.username == form_data.username)
        .first()
    )
    if not user or not verify_password(form_data.password, user.password_hash):
        db_warn("AUTH", f"Tentativo di login fallito per utente: {form_data.username}", {"ip": client_ip})
        record_failed_login(form_data.username, client_ip)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Username o password errati",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Utente disabilitato",
        )
    if user.tenant and not user.tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account sospeso. Contattare l'amministratore.",
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={
            "sub": user.username,
            "ruolo": user.ruolo,
            "userid": user.id,
            "tenant_id": user.tenant_id,
            "tv": user.token_version,
        },
        expires_delta=access_token_expires,
    )

    # Emette il JWT come cookie HttpOnly (non accessibile da JS)
    response.set_cookie(
        key=COOKIE_NAME,
        value=access_token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        path="/",
    )

    record_successful_login(user.username)
    db_info("AUTH", f"Login effettuato con successo: {user.username}", {"ruolo": user.ruolo, "tenant_id": user.tenant_id, "ip": client_ip})

    body = {
        "message": "Autenticazione completata. Credenziali emesse nel cookie.",
        "token_type": "bearer",
        "ruolo": user.ruolo,
        "username": user.username,
        "userid": user.id,
        "tenant_id": user.tenant_id,
        "tenant_nome": user.tenant.nome if user.tenant else None,
    }
    if _is_desktop_client(request):
        # Solo client nativi (Tauri): niente cookie HttpOnly nel WebView,
        # il token viene conservato dal client (rischio XSS documentato in DESKTOP.md).
        body["access_token"] = access_token
    return body


@router.get("/me")
def get_me(payload: dict = Depends(get_current_user_payload), db: Session = Depends(get_db)):
    """Ritorna i dati dell'utente corrente (utile per debug)."""
    user = (
        db.query(Utente)
        .options(joinedload(Utente.tenant))
        .filter(Utente.username == payload.get("sub"))
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")
    return {
        "userid": user.id,
        "username": user.username,
        "ruolo": user.ruolo,
        "tenant_id": user.tenant_id,
        "tenant_nome": user.tenant.nome if user.tenant else None,
        "is_active": user.is_active,
    }


@router.post("/logout")
def logout(
    response: Response,
    payload: dict = Depends(get_current_user_payload),
    db: Session = Depends(get_db)
):
    """Cancella il cookie JWT e invalida la sessione sul DB (JTI blacklist)."""
    jti = payload.get("jti")
    if jti:
        from backend.db.modelli import RevokedToken
        # Aggiunge in blacklist
        existing = db.query(RevokedToken).filter(RevokedToken.jti == jti).first()
        if not existing:
            db.add(RevokedToken(jti=jti))
            db.commit()

    response.delete_cookie(
        key=COOKIE_NAME,
        path="/",
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
    )
    return {"message": "Logout effettuato e sessione invalidata."}


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
@limiter.limit("5/minute")
def change_password(
    request: Request,
    data: PasswordChange,
    payload: dict = Depends(get_current_user_payload),
    db: Session = Depends(get_db)
):
    # SEC-027: rate limit — impedisce il brute-force della password attuale
    # da parte di chi ha rubato una sessione (cookie/token) e vuole consolidarla.
    user = db.query(Utente).filter(Utente.username == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")

    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Password attuale errata")

    if not STRONG_PWD_REGEX.match(data.new_password):
        raise HTTPException(status_code=422, detail=PASSWORD_POLICY_MESSAGE)

    user.password_hash = get_password_hash(data.new_password)
    user.token_version += 1
    db.commit()
    return {"message": "Password aggiornata con successo. Effettuare nuovamente il login."}
