from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.modules import (
    clear_tenant_module_override,
    modules_payload_for,
    set_enabled_module_ids,
    set_tenant_enabled_module_ids,
)
from backend.core.security import require_superadmin, resolve_tenant_id_leniently


router = APIRouter(tags=["modules"])


class ModulesUpdate(BaseModel):
    enabled: list[str]


def _parse_tenant_header(x_tenant_id: str | None, db: Session) -> int | None:
    """Valida X-Tenant-Id per gli endpoint admin: None se assente."""
    if not x_tenant_id:
        return None
    try:
        tenant_id = int(x_tenant_id)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail="Header X-Tenant-Id non valido: deve essere l'ID numerico di un tenant.",
        )
    from backend.db.modelli import Tenant
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail=f"Tenant {tenant_id} non trovato.")
    return tenant_id


@router.get("/modules")
def get_modules(request: Request, db: Session = Depends(get_db)):
    """Moduli attivi per il contesto della richiesta.

    Anonimo → configurazione globale; autenticato → configurazione effettiva
    del tenant (override per-tenant se presente). Il superadmin con header
    X-Tenant-Id vede i moduli del tenant selezionato.
    """
    tenant_id = resolve_tenant_id_leniently(request)
    return modules_payload_for(db, tenant_id)


@router.put("/admin/modules")
def update_modules(
    payload: ModulesUpdate,
    x_tenant_id: str | None = Header(None, alias="X-Tenant-Id"),
    db: Session = Depends(get_db),
    _sa: dict = Depends(require_superadmin),
):
    """Salva la configurazione moduli.

    Con X-Tenant-Id salva l'override del singolo tenant; senza header salva
    la configurazione globale (comportamento storico).
    """
    tenant_id = _parse_tenant_header(x_tenant_id, db)
    if tenant_id is not None:
        return set_tenant_enabled_module_ids(db, tenant_id, payload.enabled)
    return set_enabled_module_ids(payload.enabled)


@router.delete("/admin/modules/override")
def delete_modules_override(
    x_tenant_id: str | None = Header(None, alias="X-Tenant-Id"),
    db: Session = Depends(get_db),
    _sa: dict = Depends(require_superadmin),
):
    """Rimuove l'override moduli del tenant → torna alla configurazione globale."""
    tenant_id = _parse_tenant_header(x_tenant_id, db)
    if tenant_id is None:
        raise HTTPException(
            status_code=400,
            detail="Header X-Tenant-Id obbligatorio per rimuovere un override per-tenant.",
        )
    return clear_tenant_module_override(db, tenant_id)
