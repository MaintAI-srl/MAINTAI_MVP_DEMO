import re
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
)
from backend.core.rate_limiter import limiter
from backend.core.logger_db import db_info, db_warn, db_error

# Regex: Min 8, 1 uppercase, 1 lowercase, 1 number, 1 special
STRONG_PWD_REGEX = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^_-])[A-Za-z\d@$!%*?&#^_-]{8,}$")

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login")
@limiter.limit("20/minute")
def login(request: Request, response: Response, form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):

    user = (
        db.query(Utente)
        .options(joinedload(Utente.tenant))
        .filter(Utente.username == form_data.username)
        .first()
    )
    if not user or not verify_password(form_data.password, user.password_hash):
        db_warn("AUTH", f"Tentativo di login fallito per utente: {form_data.username}")
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

    db_info("AUTH", f"Login effettuato con successo: {user.username}", {"ruolo": user.ruolo, "tenant_id": user.tenant_id})

    return {
        "message": "Autenticazione completata. Credenziali emesse nel cookie.",
        "token_type": "bearer",
        "access_token": access_token,   # incluso per client nativi (Tauri) che non usano cookie
        "ruolo": user.ruolo,
        "username": user.username,
        "userid": user.id,
        "tenant_id": user.tenant_id,
        "tenant_nome": user.tenant.nome if user.tenant else None,
    }


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
def change_password(
    data: PasswordChange,
    payload: dict = Depends(get_current_user_payload),
    db: Session = Depends(get_db)
):
    user = db.query(Utente).filter(Utente.username == payload.get("sub")).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato")

    if not verify_password(data.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Password attuale errata")

    if not STRONG_PWD_REGEX.match(data.new_password):
        raise HTTPException(status_code=422, detail="La password deve avere almeno 8 caratteri, contenere maiuscole, minuscole, numeri e simboli speciali.")

    user.password_hash = get_password_hash(data.new_password)
    user.token_version += 1
    db.commit()
    return {"message": "Password aggiornata con successo. Effettuare nuovamente il login."}
