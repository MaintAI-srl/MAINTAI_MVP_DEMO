from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.db.modelli import AttivitaManutenzione, Asset

router = APIRouter()

@router.get("/scadenze/imminenti")
def get_scadenze_imminenti(
    days: int = Query(7),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Restituisce le attività di manutenzione in scadenza entro 'days' giorni."""
    now = datetime.now(timezone.utc)
    limit = now + timedelta(days=days)

    # Nota: se prossima_scadenza è NULL, l'attività viene ignorata finché non ha una data impostata.
    scadenze = db.query(AttivitaManutenzione).join(Asset).filter(
        Asset.tenant_id == tenant_id,
        AttivitaManutenzione.prossima_scadenza <= limit,
        AttivitaManutenzione.prossima_scadenza >= now - timedelta(days=365),
    ).limit(200).all()
    
    return [
        {
            "id": s.id,
            "asset_id": s.asset_id,
            "asset_nome": s.asset.nome if s.asset else "N/A",
            "descrizione": s.descrizione,
            "scadenza": s.prossima_scadenza.isoformat() if s.prossima_scadenza else None,
            "urgenza": "alta" if s.prossima_scadenza <= now + timedelta(days=2) else "media"
        } for s in scadenze
    ]
