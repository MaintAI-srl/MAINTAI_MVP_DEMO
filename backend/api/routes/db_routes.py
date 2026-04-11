import os
import re
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import text

from backend.core.dependencies import get_db
from backend.core.database import engine, Base
from backend.core.security import get_current_tenant_id, require_superadmin
from backend.db.modelli import Asset, Manuale

router = APIRouter()
logger = logging.getLogger(__name__)

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


@router.post("/db/reset")
def reset_database(_payload: dict = Depends(require_superadmin)):
    """
    DISTRUTTIVO — solo superadmin + flag ALLOW_DB_RESET=true nell'ambiente.

    Droppa tutte le tabelle e le ricrea vuote con seed di default.
    Disabilitato per default. In produzione mantenere ALLOW_DB_RESET non impostata
    o impostata a qualsiasi valore diverso da "true".
    """
    allow = os.getenv("ALLOW_DB_RESET", "").strip().lower()
    if allow != "true":
        raise HTTPException(
            status_code=403,
            detail=(
                "Operazione non consentita in questo ambiente. "
                "Per abilitare impostare ALLOW_DB_RESET=true nelle variabili d'ambiente."
            ),
        )

    username = _payload.get("sub") or _payload.get("username") or "superadmin"
    logger.warning(
        "DB RESET eseguito da '%s' — tutte le tabelle verranno eliminate e ricreate.",
        username,
    )

    from backend.core.init_db import init_db
    Base.metadata.drop_all(bind=engine)
    init_db()

    logger.warning("DB RESET completato da '%s'.", username)
    return {
        "status": "ok",
        "message": "Database resettato. Utenti seed: admin/admin (superadmin), tecnico/tecnico.",
    }


@router.post("/db/asset")
def crea_asset_db(
    nome: str,
    area: str,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    _payload: dict = Depends(require_superadmin),
):
    """Crea un asset di test (solo superadmin, filtrato per tenant)."""
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
