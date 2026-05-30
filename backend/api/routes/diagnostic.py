from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.core.exceptions import AppError
from backend.core.logging_config import get_logger
from backend.db.modelli import Ticket, Asset, DiagnosticSession, AttivitaManutenzione, Manuale
from backend.services.ai.diagnostic_service import start_diagnostic_session, continue_diagnostic_session
from backend.core.rate_limiter import limiter
from pydantic import BaseModel
import json

router = APIRouter()
logger = get_logger(__name__)


class DiagnosticReply(BaseModel):
    reply: str


@router.post("/tickets/{ticket_id}/diagnostic/start")
@limiter.limit("5/minute")
def start_session(
    ticket_id: int,
    request: Request,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    ticket = db.query(Ticket).filter(
        Ticket.id == ticket_id,
        Ticket.tenant_id == tenant_id,
    ).first()
    if not ticket:
        raise AppError(status_code=404, message=f"Ticket {ticket_id} non trovato")

    # ── Asset: tutti i campi tecnici disponibili ─────────────────────────────
    asset = None
    if ticket.asset_id:
        asset = db.query(Asset).filter(
            Asset.id == ticket.asset_id,
            Asset.tenant_id == tenant_id,
        ).first()

    ticket_dict = {
        "id": ticket.id,
        "titolo": ticket.titolo,
        "tipo": ticket.tipo,
        "descrizione": ticket.descrizione or "",
        "priorita": ticket.priorita,
        "stato": ticket.stato,
        "created_at": ticket.created_at.strftime("%d/%m/%Y") if ticket.created_at else None,
    }

    asset_dict = None
    if asset:
        asset_dict = {
            "nome": asset.nome,
            "area": asset.area,
            "descrizione": asset.descrizione,
            "marca": asset.marca,
            "modello": asset.modello,
            "matricola": asset.matricola,
            "anno_installazione": asset.anno_installazione,
            "anno_produzione": asset.anno_produzione,
            "criticita": asset.criticita,
            "posizione_fisica": asset.posizione_fisica,
            "note_tecniche": asset.note_tecniche,
            "vincoli_operativi": asset.vincoli_operativi,
            "vincoli_manutenzione": asset.vincoli_manutenzione,
            "fornitore": asset.fornitore,
        }

    # ── Storico guasti: ticket chiusi sullo stesso asset con più dettagli ────
    historical_tickets = []
    if ticket.asset_id:
        closed = db.query(Ticket).filter(
            Ticket.asset_id == ticket.asset_id,
            Ticket.tenant_id == tenant_id,
            Ticket.stato.in_(["Chiuso"]),
            Ticket.id != ticket_id,
        ).order_by(Ticket.id.desc()).limit(15).all()

        for t in closed:
            entry = {
                "id": t.id,
                "titolo": t.titolo,
                "tipo": t.tipo,
                "priorita": t.priorita,
                "descrizione": (t.descrizione or "")[:400],  # tronca per non sforare token
                "data_chiusura": t.execution_finish.strftime("%d/%m/%Y") if t.execution_finish else None,
                "data_apertura": t.created_at.strftime("%d/%m/%Y") if t.created_at else None,
            }
            # Root cause da sessione diagnostica precedente
            prev_session = db.query(DiagnosticSession).filter(
                DiagnosticSession.ticket_id == t.id,
                DiagnosticSession.status == "concluded",
            ).first()
            if prev_session and prev_session.root_cause:
                entry["root_cause_identificata"] = prev_session.root_cause[:300]
            historical_tickets.append(entry)

    # ── Attività di manutenzione pianificate per questo asset ─────────────────
    maintenance_activities = []
    if ticket.asset_id:
        activities = db.query(AttivitaManutenzione).filter(
            AttivitaManutenzione.asset_id == ticket.asset_id,
        ).limit(10).all()
        for a in activities:
            maintenance_activities.append({
                "nome": getattr(a, "nome", None) or getattr(a, "codice", None) or "N/D",
                "frequenza_giorni": getattr(a, "frequenza_giorni", None),
                "ultima_esecuzione": a.ultima_esecuzione.strftime("%d/%m/%Y") if getattr(a, "ultima_esecuzione", None) else None,
                "prossima_scadenza": a.prossima_scadenza.strftime("%d/%m/%Y") if getattr(a, "prossima_scadenza", None) else None,
            })

    # ── Manuali tecnici: testo estratto (troncato per token) ─────────────────
    manuali_context = []
    if ticket.asset_id:
        att_ids = db.query(AttivitaManutenzione.manuale_id).filter(
            AttivitaManutenzione.asset_id == ticket.asset_id,
            AttivitaManutenzione.manuale_id.isnot(None),
        ).distinct().all()
        manuale_ids = [r[0] for r in att_ids]
        if manuale_ids:
            manuali = db.query(Manuale).filter(
                Manuale.id.in_(manuale_ids),
                Manuale.tenant_id == tenant_id,
            ).all()
            for m in manuali:
                entry = {"nome": m.filename or m.nome_originale or "Manuale"}
                if m.json_estratto:
                    try:
                        data = json.loads(m.json_estratto)
                        # Prendi solo i titoli/sommari delle attività estratte
                        if isinstance(data, dict) and "attivita" in data:
                            entry["attivita_estratte"] = [
                                a.get("titolo") or a.get("nome") or ""
                                for a in data["attivita"][:10]
                            ]
                    except Exception:
                        pass
                manuali_context.append(entry)

    outcome = start_diagnostic_session(
        ticket_dict,
        asset_dict,
        historical_tickets=historical_tickets,
        maintenance_activities=maintenance_activities,
        manuali_context=manuali_context,
    )

    session = DiagnosticSession(
        ticket_id=ticket_id,
        history=json.dumps(outcome["history"]),
        status="active",
        tenant_id=tenant_id,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    logger.info("Diagnostic session %s avviata per ticket %s (tenant %s)", session.id, ticket_id, tenant_id)

    return {
        "session_id": session.id,
        "ticket_id": ticket_id,
        "step": outcome["result"],
    }


@router.post("/tickets/{ticket_id}/diagnostic/{session_id}/reply")
@limiter.limit("15/minute")
def reply_to_session(
    ticket_id: int,
    session_id: int,
    request: Request,
    payload: DiagnosticReply,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    session = db.query(DiagnosticSession).filter(
        DiagnosticSession.id == session_id,
        DiagnosticSession.ticket_id == ticket_id,
        DiagnosticSession.tenant_id == tenant_id,
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

        parent = db.query(Ticket).filter(
            Ticket.id == ticket_id,
            Ticket.tenant_id == tenant_id,
        ).first()
        if parent and not parent.diagnosi_eseguita:
            child = Ticket(
                titolo=f"CM: {root_cause[:120]}",
                asset_id=parent.asset_id,
                tipo="CM",
                priorita=parent.priorita or "Alta",
                stato="Aperto",
                durata_stimata_ore=2.0,
                fascia_oraria=parent.fascia_oraria or "diurna",
                descrizione=(
                    f"Ticket correttivo generato automaticamente dalla sessione "
                    f"diagnostica #{session_id}.\n\nCausa radice: {root_cause}"
                ),
                parent_id=ticket_id,
                tenant_id=tenant_id,
            )
            db.add(child)
            parent.diagnosi_eseguita = True
            db.flush()
            logger.info("Auto-creato ticket correttivo #%s da diagnostica %s (tenant %s)", child.id, session_id, tenant_id)

    db.commit()
    logger.info("Session %s — step type: %s", session_id, outcome["result"].get("type"))

    return {
        "session_id": session_id,
        "status": session.status,
        "step": outcome["result"],
    }
