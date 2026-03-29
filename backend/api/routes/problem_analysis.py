from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.core.dependencies import get_db
from backend.core.exceptions import AppError
from backend.core.logging_config import get_logger
from backend.db.modelli import Ticket, Asset
from backend.schemas import ProblemAnalysisRequest
from backend.services.ai.problem_analysis_service import analyze_problem_with_ai

router = APIRouter()
logger = get_logger(__name__)

@router.post("/tickets/{ticket_id}/problem-analysis")
def analyze_ticket_problem(
    ticket_id: int,
    payload: ProblemAnalysisRequest,
    db: Session = Depends(get_db)
):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()

    if not ticket:
        raise AppError(status_code=404, message=f"Ticket {ticket_id} non trovato")

    asset = db.query(Asset).filter(Asset.id == ticket.asset_id).first() if ticket.asset_id else None

    ticket_dict = {
        "titolo": ticket.titolo,
        "priorita": ticket.priorita,
        "stato": ticket.stato,
        "descrizione": ticket.descrizione,
        "durata_ore": ticket.durata_stimata_ore,
        "fascia": ticket.fascia_oraria,
    }

    asset_dict = {
        "name": asset.nome,
        
    } if asset else None

    try:
        logger.info(f"Problem analysis start — ticket {ticket_id}, method {payload.method}")

        analysis = analyze_problem_with_ai(
            ticket=ticket_dict,
            asset=asset_dict,
            symptoms=payload.symptoms,
            method=payload.method
        )

        logger.info(f"Problem analysis OK — ticket {ticket_id}")

        return {
            "ticket_id": ticket.id,
            "titolo": ticket.titolo,
            "asset_name": asset.nome if asset else "Asset sconosciuto",
            "analysis": analysis,
            "used_openai": True
        }

    except Exception as exc:
        logger.error(f"Problem analysis error — ticket {ticket_id}: {exc}")
        raise AppError(status_code=500, message=f"Errore analisi AI: {str(exc)}")