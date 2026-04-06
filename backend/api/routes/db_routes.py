import os
import re

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from backend.core.dependencies import get_db
from backend.core.database import engine, Base
from backend.core.security import get_current_tenant_id, require_superadmin
from backend.db.modelli import Asset, Manuale

router = APIRouter()

# Allowlist di nomi tabella validi per l'endpoint diagnostico schema.
# Impedisce SQL injection tramite table_name non sanitizzato.
_TABELLE_CONSENTITE = {
    "asset", "ticket", "tecnici", "impianti", "siti", "tenants", "utenti",
    "manuali", "attivita_manutenzione", "analisi_guasti", "diagnostic_sessions",
    "tecnici_assenze", "ticket_allegati", "email_config", "system_logs",
    "generated_plans",
}


@router.get("/db/schema/{table_name}")
def get_table_schema(
    table_name: str,
    _payload: dict = Depends(require_superadmin),
):
    """
    Diagnostica (solo superadmin): mostra le colonne di una tabella.
    table_name è validato contro un allowlist per prevenire SQL injection.
    """
    # Sanitizzazione: solo nomi presenti nell'allowlist, solo caratteri alfanumerici+underscore
    name_clean = re.sub(r"[^a-zA-Z0-9_]", "", table_name).lower()
    if name_clean not in _TABELLE_CONSENTITE:
        raise HTTPException(
            status_code=400,
            detail=f"Tabella '{table_name}' non disponibile per diagnostica. "
                   f"Disponibili: {sorted(_TABELLE_CONSENTITE)}",
        )
    with engine.connect() as conn:
        result = conn.execute(text(f"PRAGMA table_info({name_clean})"))
        cols = [{"name": r[1], "type": r[2]} for r in result]
    return {"table": name_clean, "columns": cols}


@router.post("/db/migrate-now")
def force_migrate(_payload: dict = Depends(require_superadmin)):
    """Forza l'esecuzione delle migrazioni (solo superadmin). Usa solo in emergenza."""
    from backend.core.init_db import _apply_migrations
    _apply_migrations()
    return {"status": "ok", "message": "Migrazioni eseguite"}


@router.post("/db/reset-emergency")
def reset_emergency(secret: str = Query(...)):
    """
    Reset di emergenza senza JWT — richiede ADMIN_SECRET dall'env.
    Usa: POST /db/reset-emergency?secret=<valore>
    Imposta ADMIN_SECRET nelle env var di Render.
    """
    admin_secret = os.getenv("ADMIN_SECRET", "")
    if not admin_secret or secret != admin_secret:
        raise HTTPException(status_code=403, detail="Secret non valido.")
    from backend.core.init_db import init_db
    Base.metadata.drop_all(bind=engine)
    init_db()
    return {"status": "ok", "message": "DB resettato. Login: admin/admin (superadmin)"}


@router.post("/db/reset")
def reset_database(_payload: dict = Depends(require_superadmin)):
    """
    DISTRUTTIVO — solo superadmin.
    Droppa tutte le tabelle e le ricrea vuote con seed di default.
    """
    from backend.core.init_db import init_db
    Base.metadata.drop_all(bind=engine)
    init_db()
    return {
        "status": "ok",
        "message": "Database resettato. Utenti seed: admin/admin (superadmin), tecnico/tecnico."
    }


@router.post("/db/asset")
def crea_asset_db(
    nome: str,
    area: str,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Crea un asset di test (richiede autenticazione, filtrato per tenant)."""
    nuovo_asset = Asset(nome=nome, area=area, note="", tenant_id=tenant_id)
    db.add(nuovo_asset)
    db.commit()
    db.refresh(nuovo_asset)
    return {"id": nuovo_asset.id, "nome": nuovo_asset.nome, "area": nuovo_asset.area}


@router.get("/db/asset")
def lista_asset_db(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Elenca asset per il tenant corrente (limitato a 200 record)."""
    assets = db.query(Asset).filter(Asset.tenant_id == tenant_id).limit(200).all()
    return [{"id": a.id, "nome": a.nome, "area": a.area} for a in assets]


@router.get("/db/manuali")
def lista_manuali_db(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Elenca manuali per il tenant corrente (limitato a 100 record)."""
    manuali = db.query(Manuale).filter(
        Manuale.tenant_id == tenant_id,
    ).order_by(Manuale.id.desc()).limit(100).all()
    return [
        {
            "id": m.id,
            "nome_file": m.nome_file,
            "pagine": m.pagine,
            "metodo_lettura": m.metodo_lettura,
            "ha_json_ai": bool(m.json_estratto and m.json_estratto.strip()),
        }
        for m in manuali
    ]
