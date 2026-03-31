from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text

from backend.core.dependencies import get_db
from backend.core.security import require_superadmin, get_password_hash
from backend.db.modelli import Tenant, Utente, Sito, Asset, Tecnico, Ticket
from backend.schemas.tenant import TenantCreate, TenantUpdate, TenantResponse

router = APIRouter(prefix="/tenants", tags=["tenants"])


def _to_response(tenant: Tenant, db: Session) -> dict:
    n_utenti = db.query(Utente).filter(Utente.tenant_id == tenant.id).count()
    n_siti = db.query(Sito).filter(Sito.tenant_id == tenant.id).count()
    n_asset = db.query(Asset).filter(Asset.tenant_id == tenant.id).count()
    n_tecnici = db.query(Tecnico).filter(Tecnico.tenant_id == tenant.id).count()
    n_ticket = db.query(Ticket).filter(Ticket.tenant_id == tenant.id).count()

    # Primo utente responsabile come admin
    admin_user = db.query(Utente).filter(
        Utente.tenant_id == tenant.id,
        Utente.ruolo.in_(["responsabile", "superadmin"])
    ).first()

    return {
        "id": tenant.id,
        "nome": tenant.nome,
        "slug": tenant.slug,
        "is_active": tenant.is_active,
        "created_at": tenant.created_at,
        "n_utenti": n_utenti,
        "n_siti": n_siti,
        "n_asset": n_asset,
        "n_tecnici": n_tecnici,
        "n_ticket": n_ticket,
        "admin_username": admin_user.username if admin_user else None,
    }


@router.get("")
def list_tenants(db: Session = Depends(get_db), _: dict = Depends(require_superadmin)):
    """Lista tutti i tenant (solo superadmin)."""
    tenants = db.query(Tenant).order_by(Tenant.nome).all()
    return [_to_response(t, db) for t in tenants]


@router.post("", status_code=201)
def create_tenant(data: TenantCreate, db: Session = Depends(get_db), _: dict = Depends(require_superadmin)):
    """Crea un nuovo tenant con il relativo utente admin (solo superadmin)."""
    # Verifica slug univoco
    existing = db.query(Tenant).filter(Tenant.slug == data.slug).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Slug '{data.slug}' già in uso")

    # Verifica username univoco
    existing_user = db.query(Utente).filter(Utente.username == data.admin_username).first()
    if existing_user:
        raise HTTPException(status_code=409, detail=f"Username '{data.admin_username}' già in uso")

    # Crea tenant
    tenant = Tenant(nome=data.nome, slug=data.slug, is_active=True)
    db.add(tenant)
    db.commit()
    db.refresh(tenant)

    # Crea utente admin per il tenant
    admin = Utente(
        username=data.admin_username,
        password_hash=get_password_hash(data.admin_password),
        ruolo="responsabile",
        tenant_id=tenant.id,
    )
    db.add(admin)
    db.commit()

    return _to_response(tenant, db)


@router.get("/{tenant_id}")
def get_tenant(tenant_id: int, db: Session = Depends(get_db), _: dict = Depends(require_superadmin)):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant non trovato")
    return _to_response(tenant, db)


@router.put("/{tenant_id}")
def update_tenant(tenant_id: int, data: TenantUpdate, db: Session = Depends(get_db), _: dict = Depends(require_superadmin)):
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant non trovato")
    if data.nome is not None:
        tenant.nome = data.nome
    if data.is_active is not None:
        tenant.is_active = data.is_active
    db.commit()
    db.refresh(tenant)
    return _to_response(tenant, db)


@router.post("/{tenant_id}/utenti", status_code=201)
def add_utente_to_tenant(
    tenant_id: int,
    data: dict,
    db: Session = Depends(get_db),
    _: dict = Depends(require_superadmin),
):
    """Aggiunge un nuovo utente a un tenant esistente."""
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant non trovato")

    username = data.get("username", "").strip()
    password = data.get("password", "")
    ruolo = data.get("ruolo", "tecnico")

    if not username or not password:
        raise HTTPException(status_code=422, detail="username e password obbligatori")
    if ruolo not in ("responsabile", "tecnico"):
        raise HTTPException(status_code=422, detail="ruolo deve essere 'responsabile' o 'tecnico'")

    existing = db.query(Utente).filter(Utente.username == username).first()
    if existing:
        raise HTTPException(status_code=409, detail=f"Username '{username}' già in uso")

    user = Utente(
        username=username,
        password_hash=get_password_hash(password),
        ruolo=ruolo,
        tenant_id=tenant_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"id": user.id, "username": user.username, "ruolo": user.ruolo, "tenant_id": user.tenant_id}


@router.get("/{tenant_id}/utenti")
def list_utenti_tenant(tenant_id: int, db: Session = Depends(get_db), _: dict = Depends(require_superadmin)):
    """Lista utenti di un tenant (solo superadmin)."""
    utenti = db.query(Utente).filter(Utente.tenant_id == tenant_id).all()
    return [{"id": u.id, "username": u.username, "ruolo": u.ruolo, "is_active": u.is_active} for u in utenti]
