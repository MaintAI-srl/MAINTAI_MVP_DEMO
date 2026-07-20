"""Router Agenti AI — trigger manuale, consumo AI in EUR, storico run.

Ogni agente è un modulo attivabile/disattivabile dal menu Funzionalità
(categoria "agenti"): il gating è per singolo agente, quindi il check
`is_module_enabled_for_tenant` avviene qui dentro e non a livello di router.
"""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.exceptions import AppError
from backend.core.logging_config import get_logger
from backend.core.modules import is_module_enabled_for_tenant
from backend.core.rate_limiter import limiter
from backend.core.security import get_current_tenant_id, get_current_user_payload
from backend.services.ai.agents_service import (
    AGENT_DEFINITIONS,
    list_agents,
    recent_runs,
    run_agent,
    usage_summary,
)

router = APIRouter(tags=["agents"])
logger = get_logger(__name__)


@router.get("/agents")
def get_agents(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Lista agenti con stato di attivazione effettivo per il tenant."""
    agents = []
    for agent in list_agents():
        agents.append({
            **agent,
            "enabled": is_module_enabled_for_tenant(db, agent["id"], tenant_id),
        })
    return {"agents": agents}


@router.get("/agents/usage")
def get_agents_usage(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Consumo AI in EUR del tenant (oggi / mese / totale)."""
    return usage_summary(db, tenant_id)


@router.get("/agents/runs")
def get_agents_runs(
    agent_id: str | None = None,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Storico run recenti degli agenti (max 20)."""
    if agent_id is not None and agent_id not in AGENT_DEFINITIONS:
        raise AppError(status_code=404, message=f"Agente '{agent_id}' inesistente")
    return {"runs": recent_runs(db, tenant_id, agent_id)}


@router.post("/agents/{agent_id}/run")
@limiter.limit("5/minute")
def trigger_agent(
    agent_id: str,
    request: Request,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    payload: dict = Depends(get_current_user_payload),
):
    """Trigger manuale di un agente: raccoglie il contesto, interroga OpenAI e
    registra il consumo in EUR."""
    if agent_id not in AGENT_DEFINITIONS:
        raise AppError(status_code=404, message=f"Agente '{agent_id}' inesistente")
    if tenant_id is None:
        # Superadmin senza contesto cliente: gli agenti lavorano sui dati di un tenant.
        raise AppError(status_code=400, message="Seleziona un cliente (contesto tenant) per eseguire gli agenti")
    if not is_module_enabled_for_tenant(db, agent_id, tenant_id):
        raise AppError(status_code=404, message="Agente disattivato per questo cliente")

    username = payload.get("sub") or payload.get("username")
    try:
        return run_agent(db, tenant_id, agent_id, username)
    except AppError:
        raise
    except Exception as exc:
        logger.error("Errore agente %s — tenant %s: %s", agent_id, tenant_id, exc)
        raise AppError(status_code=500, message=f"Errore esecuzione agente: {exc}")
