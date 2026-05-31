import os
import logging
from datetime import datetime, timedelta, timezone
import jwt
import bcrypt
from fastapi import HTTPException, Request, status, Depends, Header
from fastapi.security import OAuth2PasswordBearer
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session, joinedload
from backend.core.dependencies import get_db

_logger = logging.getLogger(__name__)

# ── JWT_SECRET ────────────────────────────────────────────────────────────────
# Obbligatoria. Nessun fallback. Il server non parte se manca.
# Generare con: python -c "import secrets; print(secrets.token_hex(32))"

_jwt_secret_raw = os.getenv("JWT_SECRET", "").strip()
if not _jwt_secret_raw:
    raise RuntimeError(
        "\n"
        "FATAL: variabile d'ambiente JWT_SECRET non impostata o vuota.\n"
        "Il backend non può avviarsi senza una chiave JWT sicura.\n"
        "\n"
        "Per generarla eseguire:\n"
        "  python -c \"import secrets; print(secrets.token_hex(32))\"\n"
        "\n"
        "Quindi impostare JWT_SECRET=<valore> nelle variabili d'ambiente\n"
        "(Render dashboard → Environment → Add variable).\n"
    )

SECRET_KEY: str = _jwt_secret_raw
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 giorni


# ── ENCRYPTION_KEY ────────────────────────────────────────────────────────────
# Obbligatoria. Deve essere una chiave Fernet valida (base64url, 32 byte).
# Nessun fallback. Il server non parte se manca o è malformata.
# Generare con: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

_encryption_key_raw = os.getenv("ENCRYPTION_KEY", "").strip()
if not _encryption_key_raw:
    raise RuntimeError(
        "\n"
        "FATAL: variabile d'ambiente ENCRYPTION_KEY non impostata o vuota.\n"
        "Il backend non può avviarsi senza una chiave di cifratura per le password IMAP.\n"
        "\n"
        "Per generarla eseguire:\n"
        "  python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"\n"
        "\n"
        "Quindi impostare ENCRYPTION_KEY=<valore> nelle variabili d'ambiente.\n"
    )

try:
    fernet = Fernet(
        _encryption_key_raw.encode()
        if isinstance(_encryption_key_raw, str)
        else _encryption_key_raw
    )
except Exception as _fernet_exc:
    raise RuntimeError(
        "\n"
        f"FATAL: ENCRYPTION_KEY non è una chiave Fernet valida: {_fernet_exc}\n"
        "\n"
        "La chiave deve essere generata con:\n"
        "  python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"\n"
        "\n"
        "Non usare stringhe arbitrarie — il formato Fernet richiede base64url di 32 byte.\n"
    ) from _fernet_exc


# ── Cookie settings ──────────────────────────────────────────────────────────

COOKIE_NAME = "maintai_jwt"
COOKIE_MAX_AGE = ACCESS_TOKEN_EXPIRE_MINUTES * 60  # secondi
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "true").strip().lower() == "true"
COOKIE_SAMESITE = os.getenv("COOKIE_SAMESITE", "lax")


# ── Token extraction (cookie-first, Authorization header fallback) ────────────

# Mantenuto per compatibilità Swagger UI e API client
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login", auto_error=False)


async def _extract_token(
    request: Request,
    bearer: str | None = Depends(oauth2_scheme),
) -> str:
    """Estrae il JWT: priorità al cookie HttpOnly, fallback su Authorization: Bearer."""
    token = request.cookies.get(COOKIE_NAME)
    if token:
        return token
    if bearer:
        return bearer
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Non autenticato",
        headers={"WWW-Authenticate": "Bearer"},
    )


# ── Password hashing ─────────────────────────────────────────────────────────

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


# ── Fernet encryption (persistenza password IMAP) ────────────────────────────

def encrypt_data(plain_text: str) -> str:
    """Cifra una stringa usando Fernet. Usato per le password IMAP."""
    return fernet.encrypt(plain_text.encode()).decode()


def decrypt_data(encrypted_text: str) -> str:
    """Decifra una stringa cifrata con Fernet."""
    if not encrypted_text:
        return encrypted_text
    try:
        return fernet.decrypt(encrypted_text.encode()).decode()
    except (InvalidToken, Exception):
        # La stringa non è cifrata o è corrotta — restituisce l'originale
        # (supporto legacy per password salvate in chiaro prima della cifratura)
        return encrypted_text


# ── JWT ──────────────────────────────────────────────────────────────────────

import uuid

def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=15)
    )
    to_encode.update({"exp": expire, "jti": str(uuid.uuid4())})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token scaduto"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Token non valido"
        )


def _check_user_active(payload: dict, db: Session) -> None:
    """Verifica che l'utente e il suo tenant siano attivi ad ogni richiesta autenticata."""
    from backend.db.modelli import Utente
    username = payload.get("sub")
    if not username:
        return
    user = (
        db.query(Utente)
        .options(joinedload(Utente.tenant))
        .filter(Utente.username == username)
        .first()
    )
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Utente disabilitato. Contattare l'amministratore.",
        )
    if user.tenant and not user.tenant.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account sospeso. Contattare l'amministratore.",
        )
    
    # Verifica Blacklist JWT specifica (Logout isolato)
    jti = payload.get("jti")
    if jti:
        from backend.db.modelli import RevokedToken
        revoked = db.query(RevokedToken).filter(RevokedToken.jti == jti).first()
        if revoked:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Sessione terminata. Effettua nuovamente l'accesso."
            )

    # Token Version Check (Invalidates old tokens instantly across all sessions on password change)
    token_tv = payload.get("tv")
    if token_tv is not None and user.token_version > token_tv:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="La sessione è scaduta o la password è stata modificata. Effettua nuovamente l'accesso."
        )


def get_current_user_payload(
    token: str = Depends(_extract_token),
    db: Session = Depends(get_db),
) -> dict:
    payload = decode_access_token(token)
    _check_user_active(payload, db)
    return payload


# ── Tenant resolution ────────────────────────────────────────────────────────

def get_current_tenant_id(
    payload: dict = Depends(get_current_user_payload),
    x_tenant_id: str | None = Header(None, alias="X-Tenant-Id"),
) -> int | None:
    """
    Estrae il tenant_id dal token JWT o dall'header X-Tenant-Id (solo superadmin).
    """
    tid = payload.get("tenant_id")
    ruolo = payload.get("ruolo")

    if ruolo == "superadmin":
        resolved_tid = None
        if x_tenant_id:
            try:
                resolved_tid = int(x_tenant_id)
            except ValueError:
                pass
        else:
            resolved_tid = int(tid) if tid else None
        
        from backend.core.database import current_tenant_id
        current_tenant_id.set(resolved_tid)
        return resolved_tid

    if tid is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant non configurato per questo utente. Contattare l'amministratore.",
        )
    
    from backend.core.database import current_tenant_id
    current_tenant_id.set(int(tid))
    return int(tid)


def require_superadmin(payload: dict = Depends(get_current_user_payload)) -> dict:
    """Verifica che l'utente sia superadmin."""
    if payload.get("ruolo") != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accesso riservato al superadmin.",
        )
    return payload


def require_roles(*allowed_roles: str):
    """
    Dependency factory: consente l'accesso solo agli utenti con uno dei
    ruoli indicati. Il superadmin è sempre autorizzato.

    Uso:
        _: dict = Depends(require_roles("responsabile"))
    """
    allowed = set(allowed_roles)

    def _dep(payload: dict = Depends(get_current_user_payload)) -> dict:
        ruolo = payload.get("ruolo")
        if ruolo != "superadmin" and ruolo not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Operazione non consentita per il tuo ruolo.",
            )
        return payload

    return _dep


# ── Object-level authorization ───────────────────────────────────────────────

def check_tenant_ownership(db, model, object_id: int, tenant_id: int):
    """
    Verifica che un oggetto esista e appartenga al tenant corrente.
    Solleva 404 per non rivelare l'esistenza di risorse di altri tenant.
    """
    if tenant_id is None:
        return  # Superadmin senza contesto tenant: skip check

    obj = db.query(model).filter(
        model.id == object_id, model.tenant_id == tenant_id
    ).first()
    if not obj:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"{model.__name__} non trovato o accesso non autorizzato.",
        )
    return obj
