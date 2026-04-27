import re
import logging
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import get_current_user_payload, get_current_tenant_id, get_password_hash
from backend.core.logger_db import db_info
from backend.db.modelli import Utente, Tecnico

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/utenti", tags=["utenti"])

# Regex: Min 8, 1 uppercase, 1 lowercase, 1 number, 1 special
STRONG_PWD_REGEX = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#^_-])[A-Za-z\d@$!%*?&#^_-]{8,}$")

RUOLI_VALIDI = {"responsabile", "tecnico"}


def _require_responsabile_or_admin(payload: dict) -> None:
    """Verifica che l'utente sia responsabile o superadmin."""
    ruolo = payload.get("ruolo")
    if ruolo not in ("responsabile", "superadmin"):
        raise HTTPException(status_code=403, detail="Accesso riservato al responsabile o superadmin.")


def _utente_to_dict(u: Utente, db: Session) -> dict:
    """Converte un utente in dizionario, con id del tecnico collegato se esiste."""
    tecnico = db.query(Tecnico).filter(Tecnico.utente_id == u.id).first()
    return {
        "id": u.id,
        "username": u.username,
        "ruolo": u.ruolo,
        "is_active": u.is_active,
        "tenant_id": u.tenant_id,
        "tecnico_id": tecnico.id if tecnico else None,
        "tecnico_nome": f"{tecnico.nome} {tecnico.cognome or ''}".strip() if tecnico else None,
    }


@router.get("")
def list_utenti(
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Lista utenti del tenant corrente. Accessibile a responsabile e superadmin."""
    _require_responsabile_or_admin(payload)

    if tenant_id is None:
        # superadmin senza contesto tenant: ritorna lista vuota
        return []

    utenti = (
        db.query(Utente)
        .filter(Utente.tenant_id == tenant_id)
        .order_by(Utente.username)
        .all()
    )
    return [_utente_to_dict(u, db) for u in utenti]


class UtenteCreate(BaseModel):
    username: str
    password: str
    ruolo: str = "tecnico"


@router.post("", status_code=201)
def create_utente(
    data: UtenteCreate,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Crea un nuovo utente nel tenant corrente. Accessibile a responsabile e superadmin."""
    _require_responsabile_or_admin(payload)

    if tenant_id is None:
        raise HTTPException(status_code=400, detail="Contesto tenant non disponibile. Impersonare un tenant prima.")

    username = data.username.strip()
    if not username:
        raise HTTPException(status_code=422, detail="Username obbligatorio.")

    if data.ruolo not in RUOLI_VALIDI:
        raise HTTPException(status_code=422, detail=f"Ruolo non valido. Valori ammessi: {', '.join(sorted(RUOLI_VALIDI))}")

    if not STRONG_PWD_REGEX.match(data.password):
        raise HTTPException(
            status_code=422,
            detail="La password deve avere almeno 8 caratteri, contenere maiuscole, minuscole, numeri e simboli speciali (@$!%*?&#^_-).",
        )

    existing = db.query(Utente).filter(Utente.username == username).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Username '{username}' già in uso.")

    user = Utente(
        username=username,
        password_hash=get_password_hash(data.password),
        ruolo=data.ruolo,
        tenant_id=tenant_id,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    try:
        db_info("utenti", f"Nuovo utente creato: {username} (ruolo={data.ruolo}) nel tenant {tenant_id} da {payload.get('sub')}", tenant_id=tenant_id)
    except Exception:
        pass

    logger.info("Nuovo utente %s creato nel tenant %s da %s", username, tenant_id, payload.get("sub"))
    return _utente_to_dict(user, db)


class PasswordReset(BaseModel):
    new_password: str


@router.put("/{user_id}/password")
def reset_password(
    user_id: int,
    data: PasswordReset,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Resetta la password di un utente del tenant. Accessibile a responsabile e superadmin."""
    _require_responsabile_or_admin(payload)

    user = db.query(Utente).filter(Utente.id == user_id, Utente.tenant_id == tenant_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato.")

    if not STRONG_PWD_REGEX.match(data.new_password):
        raise HTTPException(
            status_code=422,
            detail="La password deve avere almeno 8 caratteri, contenere maiuscole, minuscole, numeri e simboli speciali (@$!%*?&#^_-).",
        )

    user.password_hash = get_password_hash(data.new_password)
    user.token_version += 1  # Invalida JWT vecchi
    db.commit()

    logger.info("Password resettata per utente %s da %s", user.username, payload.get("sub"))
    return {"ok": True, "message": f"Password di '{user.username}' aggiornata. Sessioni precedenti invalidate."}


@router.put("/{user_id}/toggle-active")
def toggle_active(
    user_id: int,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user_payload),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Attiva o disattiva un utente del tenant. Accessibile a responsabile e superadmin."""
    _require_responsabile_or_admin(payload)

    user = db.query(Utente).filter(Utente.id == user_id, Utente.tenant_id == tenant_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Utente non trovato.")

    # Impedisce di disabilitare se stesso
    if user.username == payload.get("sub"):
        raise HTTPException(status_code=400, detail="Non puoi disabilitare il tuo stesso account.")

    user.is_active = not user.is_active
    if not user.is_active:
        user.token_version += 1  # Invalida JWT attivi
    db.commit()

    stato = "attivato" if user.is_active else "disattivato"
    logger.info("Utente %s %s da %s", user.username, stato, payload.get("sub"))
    return {"ok": True, "is_active": user.is_active, "message": f"Utente '{user.username}' {stato}."}
