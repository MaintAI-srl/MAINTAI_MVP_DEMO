import os
from datetime import datetime, timedelta, timezone
import jwt
import bcrypt
from fastapi import HTTPException, status, Depends, Header
from fastapi.security import OAuth2PasswordBearer

SECRET_KEY = os.getenv("JWT_SECRET", "super-secret-key-maintai-v2")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')

def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def decode_access_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token scaduto")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token non valido")

def get_current_user_payload(token: str = Depends(oauth2_scheme)):
    return decode_access_token(token)

def get_current_tenant_id(
    payload: dict = Depends(get_current_user_payload),
    x_tenant_id: str | None = Header(None, alias="X-Tenant-Id")
) -> int | None:
    """
    Estrae il tenant_id dal token JWT o dall'header X-Tenant-Id (solo per superadmin).
    """
    tid = payload.get("tenant_id")
    ruolo = payload.get("ruolo")

    if ruolo == "superadmin":
        # Il superadmin può forzare un tenant tramite header
        if x_tenant_id:
            try:
                return int(x_tenant_id)
            except ValueError:
                pass
        return int(tid) if tid else None

    if tid is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant non configurato per questo utente. Contattare l'amministratore.",
        )
    return int(tid)

def require_superadmin(payload: dict = Depends(get_current_user_payload)) -> dict:
    """Verifica che l'utente sia superadmin. Usato per la gestione tenant."""
    if payload.get("ruolo") != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accesso riservato al superadmin.",
        )
    return payload

def check_tenant_ownership(db, model, object_id: int, tenant_id: int):
    """
    Verifica che un oggetto di un dato modello esista e appartenga al tenant corrente.
    Se non esiste o appartiene a un altro tenant, solleva un 404 (Security by Obscurity).
    """
    if tenant_id is None:
        return # Skip check for superadmin if they are ignoring tenant
    
    obj = db.query(model).filter(model.id == object_id, model.tenant_id == tenant_id).first()
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{model.__name__} non trovato o accesso non autorizzato."
        )
    return obj
