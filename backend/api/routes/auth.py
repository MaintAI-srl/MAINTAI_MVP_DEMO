from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session, joinedload
from backend.core.dependencies import get_db
from backend.db.modelli import Utente
from backend.core.security import verify_password, create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES, get_current_user_payload

router = APIRouter(prefix="/auth", tags=["auth"])

@router.post("/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = (
        db.query(Utente)
        .options(joinedload(Utente.tenant))
        .filter(Utente.username == form_data.username)
        .first()
    )
    if not user or not verify_password(form_data.password, user.password_hash):
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
        },
        expires_delta=access_token_expires,
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
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
        "username": user.username,
        "ruolo": user.ruolo,
        "tenant_id": user.tenant_id,
        "tenant_nome": user.tenant.nome if user.tenant else None,
        "is_active": user.is_active,
    }
