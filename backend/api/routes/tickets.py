from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel as PydanticModel

from backend.core.dependencies import get_db
from backend.repositories.ticket_repository import ticket_repository, _ticket_to_dict
from backend.schemas.ticket import TicketCreate, TicketUpdate
from backend.core.logging_config import get_logger
from backend.core.exceptions import AppError
from backend.db.modelli import Ticket, AttivitaManutenzione

router = APIRouter()
logger = get_logger(__name__)


class BulkStatusUpdate(PydanticModel):
    ids: list[int]
    stato: str


def _aggiorna_scadenza_piano(db: Session, ticket: Ticket):
    """
    Quando un ticket viene chiuso con execution_finish valorizzato:
    - aggiorna ultima_esecuzione dell'attività manutentiva collegata
    - ricalcola prossima_scadenza = ultima_esecuzione + frequenza_giorni
    """
    if not ticket.attivita_manutenzione_id or not ticket.execution_finish:
        return
    att = db.query(AttivitaManutenzione).filter(
        AttivitaManutenzione.id == ticket.attivita_manutenzione_id
    ).first()
    if not att:
        return
    att.ultima_esecuzione = ticket.execution_finish
    if att.frequenza_giorni:
        att.prossima_scadenza = ticket.execution_finish + timedelta(days=att.frequenza_giorni)
    db.commit()


@router.get("/tickets")
def get_tickets(
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    stato: Optional[str] = Query(None),
    tecnico_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
):
    stati = [s.strip() for s in stato.split(",")] if stato else None
    return ticket_repository.get_paginated(db, page=page, limit=limit, stati=stati, tecnico_id=tecnico_id)


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int, db: Session = Depends(get_db)):
    ticket = ticket_repository.get_by_id(db, ticket_id)
    if not ticket:
        raise AppError(status_code=404, message=f"Ticket {ticket_id} non trovato")
    return _ticket_to_dict(ticket)


@router.post("/tickets")
def create_ticket(data: TicketCreate, db: Session = Depends(get_db)):
    ticket = ticket_repository.create(db, data)
    return _ticket_to_dict(ticket)


@router.patch("/tickets/bulk-status")
def bulk_update_status(data: BulkStatusUpdate, db: Session = Depends(get_db)):
    updated = db.query(Ticket).filter(Ticket.id.in_(data.ids)).update(
        {"stato": data.stato}, synchronize_session=False
    )
    db.commit()
    return {"updated": updated, "stato": data.stato}


@router.put("/tickets/{ticket_id}")
def update_ticket(ticket_id: int, data: TicketUpdate, db: Session = Depends(get_db)):
    result = ticket_repository.update(db, ticket_id, data)
    if not result:
        raise AppError(status_code=404, message=f"Ticket {ticket_id} non trovato")

    # Se il ticket viene chiuso, aggiorna la scadenza del piano manutentivo collegato
    if data.stato == "Chiuso":
        ticket_orm = ticket_repository.get_by_id(db, ticket_id)
        if ticket_orm:
            _aggiorna_scadenza_piano(db, ticket_orm)

    return result

import io
import csv
from fastapi.responses import StreamingResponse

@router.get("/export/tickets")
def export_tickets_csv(db: Session = Depends(get_db)):
    """Esporta tutti i ticket a sistema in formato CSV (apribile con Excel)."""
    # Fetch all tickets with a high limit
    data = ticket_repository.get_paginated(db, page=1, limit=10000)
    items = data.get("items", [])
    
    output = io.StringIO()
    writer = csv.writer(output, delimiter=';') # Usa punto e virgola per compatibilità Excel europeo
    
    # Header
    writer.writerow([
        "ID", "Titolo", "Asset ID", "Asset Nome", "Priorita", "Stato", "Tipo",
        "Durata Stimata", "Tecnico ID", "Inizio Pianificato", "Fine Pianificata"
    ])
    
    # Righe
    for t in items:
        writer.writerow([
            t.get("id"),
            t.get("titolo"),
            t.get("asset_id"),
            t.get("asset_name"),
            t.get("priorita"),
            t.get("stato"),
            t.get("tipo"),
            t.get("durata_stimata_ore"),
            t.get("tecnico_id"),
            t.get("planned_start"),
            t.get("planned_finish")
        ])
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]), 
        media_type="text/csv", 
        headers={"Content-Disposition": "attachment; filename=maintai_tickets_export.csv"}
    )

import os
import uuid
from fastapi import UploadFile, File, HTTPException
from backend.db.modelli import TicketAllegato
from backend.core import storage

@router.post("/tickets/{ticket_id}/allegati")
async def upload_ticket_allegato(ticket_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")

    ext = os.path.splitext(file.filename)[1] if file.filename else ""
    unique_filename = f"{uuid.uuid4()}{ext}"

    content = await file.read()
    url = storage.save_file(content, unique_filename)

    allegato = TicketAllegato(
        ticket_id=ticket_id,
        nome_file=file.filename or unique_filename,
        percorso=url,
        tipo_mime=file.content_type,
        dimensione_bytes=len(content)
    )
    db.add(allegato)
    db.commit()
    db.refresh(allegato)

    return {
        "id": allegato.id,
        "nome_file": allegato.nome_file,
        "url": allegato.percorso,
        "tipo_mime": allegato.tipo_mime
    }

@router.get("/tickets/{ticket_id}/allegati")
def get_ticket_allegati(ticket_id: int, db: Session = Depends(get_db)):
    allegati = db.query(TicketAllegato).filter(TicketAllegato.ticket_id == ticket_id).all()
    return [
        {
            "id": a.id,
            "nome_file": a.nome_file,
            "url": a.percorso,
            "tipo_mime": a.tipo_mime,
            "creato_il": a.creato_il.isoformat() if a.creato_il else None
        } for a in allegati
    ]

import base64
import uuid

@router.post("/tickets/{ticket_id}/firma")
async def upload_ticket_firma(ticket_id: int, data: dict, db: Session = Depends(get_db)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")

    base64_str = data.get("image")
    if not base64_str:
        raise HTTPException(status_code=400, detail="Immagine firma mancante")

    if "," in base64_str:
        base64_str = base64_str.split(",")[1]

    filename = f"firma_{ticket_id}_{uuid.uuid4().hex[:8]}.png"
    content = base64.b64decode(base64_str)
    url = storage.save_file(content, filename)

    ticket.firma_percorso = url
    db.commit()
    return {"url": ticket.firma_percorso}
