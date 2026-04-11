from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.core.exceptions import AppError
from backend.core.logging_config import get_logger
from backend.db.modelli import Ticket, Asset
from backend.schemas import ProblemAnalysisRequest
from backend.services.ai.problem_analysis_service import analyze_problem_with_ai

from backend.core.rate_limiter import limiter

router = APIRouter()
logger = get_logger(__name__)

@router.post("/tickets/{ticket_id}/problem-analysis")
@limiter.limit("5/minute")
def analyze_ticket_problem(
    ticket_id: int,
    payload: ProblemAnalysisRequest,
    request: Request,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    # Filtro tenant_id: impedisce accesso cross-tenant
    ticket = db.query(Ticket).filter(
        Ticket.id == ticket_id,
        Ticket.tenant_id == tenant_id,
    ).first()

    if not ticket:
        raise AppError(status_code=404, message=f"Ticket {ticket_id} non trovato")

    asset = None
    if ticket.asset_id:
        asset = db.query(Asset).filter(
            Asset.id == ticket.asset_id,
            Asset.tenant_id == tenant_id,
        ).first()

    ticket_dict = {
        "titolo": ticket.titolo,
        "priorita": ticket.priorita,
        "stato": ticket.stato,
        "descrizione": ticket.descrizione,
        "durata_ore": ticket.durata_stimata_ore,
        "fascia": ticket.fascia_oraria,
    }

    asset_dict = {"name": asset.nome} if asset else None

    try:
        logger.info("Problem analysis start — ticket %s, method %s, tenant %s", ticket_id, payload.method, tenant_id)

        analysis = analyze_problem_with_ai(
            ticket=ticket_dict,
            asset=asset_dict,
            symptoms=payload.symptoms,
            method=payload.method
        )

        logger.info("Problem analysis OK — ticket %s", ticket_id)

        return {
            "ticket_id": ticket.id,
            "titolo": ticket.titolo,
            "asset_name": asset.nome if asset else "Asset sconosciuto",
            "analysis": analysis,
            "used_openai": True
        }

    except Exception as exc:
        logger.error("Problem analysis error — ticket %s: %s", ticket_id, exc)
        raise AppError(status_code=500, message=f"Errore analisi AI: {str(exc)}")
