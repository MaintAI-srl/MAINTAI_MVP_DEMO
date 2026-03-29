from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.core.dependencies import get_db
from backend.core.exceptions import AppError
from backend.core.logging_config import get_logger
from backend.db.modelli import Ticket, Asset, DiagnosticSession, AttivitaManutenzione, Manuale
from backend.services.ai.diagnostic_service import start_diagnostic_session, continue_diagnostic_session
from pydantic import BaseModel
import json

router = APIRouter()
logger = get_logger(__name__)

class DiagnosticReply(BaseModel):
    reply: str

@router.post("/tickets/{ticket_id}/diagnostic/start")
def start_session(ticket_id: int, db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise AppError(status_code=404, message=f"Ticket {ticket_id} non trovato")

    asset = db.query(Asset).filter(Asset.id == ticket.asset_id).first() if ticket.asset_id else None

    ticket_dict = {"titolo": ticket.titolo, "descrizione": ticket.descrizione,
                   "priorita": ticket.priorita, "stato": ticket.stato}
    asset_dict = {"nome": asset.nome, "categoria": ""} if asset else None

    # Historical context: closed tickets for same asset
    historical_tickets = []
    manuali_context = []
    if ticket.asset_id:
        closed = db.query(Ticket).filter(
            Ticket.asset_id == ticket.asset_id,
            Ticket.stato.in_(["Chiuso", "Eliminato"]),
            Ticket.id != ticket_id,
        ).order_by(Ticket.id.desc()).limit(10).all()
        historical_tickets = [{"titolo": t.titolo, "stato": t.stato, "priorita": t.priorita} for t in closed]

        att_ids = db.query(AttivitaManutenzione.manuale_id).filter(
            AttivitaManutenzione.asset_id == ticket.asset_id,
            AttivitaManutenzione.manuale_id.isnot(None)
        ).distinct().all()
        manuale_ids = [r[0] for r in att_ids]
        if manuale_ids:
            manuali = db.query(Manuale).filter(Manuale.id.in_(manuale_ids)).all()
            for m in manuali:
                if m.json_estratto:
                    try:
                        import json as _json
                        data = _json.loads(m.json_estratto)
                        manuali_context.append({"file": m.nome_file, "attivita": len(data.get("attivita", []))})
                    except Exception:
                        pass

    outcome = start_diagnostic_session(ticket_dict, asset_dict, historical_tickets=historical_tickets)

    session = DiagnosticSession(
        ticket_id=ticket_id,
        history=json.dumps(outcome["history"]),
        status="active"
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    logger.info(f"Diagnostic session {session.id} avviata per ticket {ticket_id}")

    return {
        "session_id": session.id,
        "ticket_id": ticket_id,
        "step": outcome["result"]
    }


@router.post("/tickets/{ticket_id}/diagnostic/{session_id}/reply")
def reply_to_session(
    ticket_id: int,
    session_id: int,
    payload: DiagnosticReply,
    db: Session = Depends(get_db)
):
    session = db.query(DiagnosticSession).filter(
        DiagnosticSession.id == session_id,
        DiagnosticSession.ticket_id == ticket_id
    ).first()

    if not session:
        raise AppError(status_code=404, message="Sessione diagnostica non trovata")
    if session.status == "concluded":
        raise AppError(status_code=400, message="Sessione già conclusa")

    history = json.loads(session.history)
    outcome = continue_diagnostic_session(history, payload.reply)

    session.history = json.dumps(outcome["history"])

    if outcome["result"].get("type") == "conclusion":
        session.status = "concluded"
        root_cause = outcome["result"].get("root_cause") or outcome["result"].get("content") or "Causa radice identificata"
        session.root_cause = root_cause

        # v3.4 — auto-crea ticket correttivo figlio
        parent = db.query(Ticket).filter(Ticket.id == ticket_id).first()
        if parent and not parent.diagnosi_eseguita:
            child = Ticket(
                titolo=f"CM: {root_cause[:120]}",
                asset_id=parent.asset_id,
                tipo="CM",
                priorita=parent.priorita or "Alta",
                stato="Aperto",
                durata_stimata_ore=2.0,
                fascia_oraria=parent.fascia_oraria or "diurna",
                descrizione=f"Ticket correttivo generato automaticamente dalla sessione diagnostica #{session_id}.\n\nCausa radice: {root_cause}",
                parent_id=ticket_id,
            )
            db.add(child)
            parent.diagnosi_eseguita = True
            db.flush()
            logger.info(f"Auto-creato ticket correttivo #{child.id} da diagnostica sessione {session_id}")

    db.commit()

    logger.info(f"Session {session_id} — step type: {outcome['result'].get('type')}")

    return {
        "session_id": session_id,
        "status": session.status,
        "step": outcome["result"]
    }