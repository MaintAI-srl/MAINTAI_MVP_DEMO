from datetime import timedelta, datetime, timezone, time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from backend.core.rate_limiter import limiter
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel as PydanticModel

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id, get_current_user_payload
from backend.repositories.ticket_repository import ticket_repository, _ticket_to_dict
from backend.schemas.ticket import TicketCreate, TicketUpdate
from backend.core.logging_config import get_logger
from backend.core.exceptions import AppError
from backend.core.logger_db import log_to_db
from backend.db.modelli import Ticket, AttivitaManutenzione, Asset, Impianto, Sito, Tecnico, TecnicoAssenza
from sqlalchemy.orm import joinedload as _joinedload
from backend.repositories.ticket_repository import _resolve_hierarchy
from backend.services.condition_maintenance_service import latest_running_hours_by_asset

router = APIRouter()
logger = get_logger(__name__)


STATI_VALIDI = {"Aperto", "Pianificato", "In corso", "Chiuso", "Eliminato"}
MAX_ALLEGATO_BYTES = 20 * 1024 * 1024  # 20 MB
MAX_FIRMA_BYTES = 5 * 1024 * 1024  # 5 MB
ALLOWED_UPLOAD_EXTENSIONS = {
    '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp',
    '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt',
    '.mp4', '.mov', '.zip',
}


class BulkStatusUpdate(PydanticModel):
    ids: list[int]
    stato: str
    asset_stato: Optional[str] = None
    planned_start: Optional[datetime] = None
    planned_finish: Optional[datetime] = None
    execution_start: Optional[datetime] = None
    execution_finish: Optional[datetime] = None
    is_manual_plan: Optional[bool] = None
    eliminazione_note: Optional[str] = None


def _aggiorna_scadenza_piano(db: Session, ticket: Ticket):
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
    if getattr(att, "condition_metric", None) == "running_hours" and ticket.asset_id:
        latest = latest_running_hours_by_asset(db, ticket.tenant_id, [ticket.asset_id]).get(ticket.asset_id)
        if latest:
            att.condition_last_done_hours = latest.value
    db.commit()


def _validate_ticket_update(data: TicketUpdate, ticket: Ticket) -> None:
    if data.stato is not None and data.stato not in STATI_VALIDI:
        raise HTTPException(
            status_code=400,
            detail=f"Stato non valido: '{data.stato}'. Valori ammessi: {sorted(STATI_VALIDI)}",
        )
    if data.stato == "Pianificato" and not data.planned_start and not ticket.planned_start:
        raise HTTPException(status_code=400, detail="Pianificazione mancante: inserire data inizio.")
    if data.stato == "Eliminato" and (not data.eliminazione_note or len(data.eliminazione_note) < 5):
        raise HTTPException(status_code=400, detail="Il motivo dell'eliminazione e obbligatorio (min 5 caratteri).")
    if data.durata_stimata_ore is not None and data.durata_stimata_ore <= 0:
        raise HTTPException(status_code=400, detail="La durata stimata deve essere maggiore di zero.")


def _validate_planning_capacity(db: Session, data: TicketUpdate, ticket: Ticket, tenant_id: int | None) -> None:
    fields_set = data.model_fields_set
    target_status = data.stato or ticket.stato
    if target_status != "Pianificato":
        return

    target_tecnico_id = data.tecnico_id if "tecnico_id" in fields_set else ticket.tecnico_id
    target_start = data.planned_start if "planned_start" in fields_set else ticket.planned_start
    if not target_tecnico_id or not target_start:
        return

    tecnico_query = db.query(Tecnico).filter(Tecnico.id == target_tecnico_id)
    if tenant_id is not None:
        tecnico_query = tecnico_query.filter(Tecnico.tenant_id == tenant_id)
    tecnico = tecnico_query.first()
    if not tecnico:
        raise HTTPException(status_code=400, detail="Tecnico non trovato per la pianificazione.")

    planned_day = target_start.date()
    day_start = datetime.combine(planned_day, time.min)
    day_end = datetime.combine(planned_day, time.max)

    assenza_query = db.query(TecnicoAssenza).filter(
        TecnicoAssenza.tecnico_id == target_tecnico_id,
        TecnicoAssenza.data_inizio <= day_end,
        TecnicoAssenza.data_fine >= day_start,
    )
    if tenant_id is not None:
        assenza_query = assenza_query.filter(TecnicoAssenza.tenant_id == tenant_id)
    assenza = assenza_query.first()
    if assenza:
        raise HTTPException(status_code=400, detail=f"Tecnico non disponibile: {assenza.tipo_assenza}.")

    planned_query = db.query(func.coalesce(func.sum(Ticket.durata_stimata_ore), 0.0)).filter(
        Ticket.tecnico_id == target_tecnico_id,
        Ticket.id != ticket.id,
        Ticket.planned_start >= day_start,
        Ticket.planned_start <= day_end,
        Ticket.stato.in_(["Pianificato", "In corso"]),
    )
    if tenant_id is not None:
        planned_query = planned_query.filter(Ticket.tenant_id == tenant_id)
    already_assigned = float(planned_query.scalar() or 0.0)
    capacity = float(tecnico.ore_giornaliere or 8)
    requested = float(data.durata_stimata_ore or ticket.durata_stimata_ore or 1)
    remaining = capacity - already_assigned
    if requested > remaining + 0.001:
        raise HTTPException(
            status_code=400,
            detail=f"Capienza insufficiente per {tecnico.nome}: restano {max(0, remaining):.1f}h, il ticket richiede {requested:.1f}h.",
        )


@router.get("/tickets")
def get_tickets(
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    stato: Optional[str] = Query(None),
    tecnico_id: Optional[int] = Query(None),
    piano_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    stati = [s.strip() for s in stato.split(",")] if stato else None
    
    # Se presente piano_id, passiamo il filtro al repository
    # (Il repository ticket_repository.get_paginated deve essere aggiornato o filtrato qui)
    # Per semplicità, filtriamo qui se possibile o aggiorniamo il repo
    return ticket_repository.get_paginated(
        db, 
        tenant_id=tenant_id, 
        page=page, 
        limit=limit, 
        stati=stati, 
        tecnico_id=tecnico_id,
        piano_id=piano_id
    )


@router.get("/tickets/durata-media")
def get_durata_media(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Restituisce la durata media stimata dei ticket chiusi raggruppata per tipo e
    (opzionalmente) per asset. Utile per calibrare le stime future degli interventi.

    Usa solo `durata_stimata_ore` dei ticket Chiusi — è il proxy disponibile
    finché non esiste un campo `durata_reale_ore` nel modello dati.
    Workaround esplicito: aggiornare con campo reale quando disponibile.
    """
    rows = (
        db.query(
            Ticket.tipo,
            Ticket.asset_id,
            func.avg(Ticket.durata_stimata_ore).label("durata_media"),
            func.count(Ticket.id).label("campione"),
        )
        .filter(
            Ticket.tenant_id == tenant_id,
            Ticket.stato == "Chiuso",
            Ticket.durata_stimata_ore.isnot(None),
            Ticket.deleted_at.is_(None),
        )
        .group_by(Ticket.tipo, Ticket.asset_id)
        .order_by(Ticket.tipo, Ticket.asset_id)
        .limit(200)
        .all()
    )

    return {
        "stime": [
            {
                "tipo": row.tipo or "CM",
                "asset_id": row.asset_id,
                "durata_media_ore": round(row.durata_media, 2) if row.durata_media else None,
                "campione": row.campione,
            }
            for row in rows
        ]
    }


@router.get("/tickets/{ticket_id}")
def get_ticket(ticket_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    ticket = ticket_repository.get_by_id(db, ticket_id, tenant_id)
    if not ticket:
        raise AppError(status_code=404, message=f"Ticket {ticket_id} non trovato")
    return _ticket_to_dict(ticket)


@router.post("/sync-tickets-hierarchy")
def sync_ticket_hierarchy(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Backfill: popola sito_name e impianto_name su tutti i ticket del tenant."""
    tickets = (
        db.query(Ticket)
        .options(
            _joinedload(Ticket.asset)
            .joinedload(Asset.impianto)
            .joinedload(Impianto.sito)
        )
        .filter(Ticket.tenant_id == tenant_id)
        .all()
    )
    updated = 0
    for t in tickets:
        sito, imp = _resolve_hierarchy(t.asset)
        changed = False
        if sito and t.sito_name != sito:
            t.sito_name = sito
            changed = True
        if imp and t.impianto_name != imp:
            t.impianto_name = imp
            changed = True
        if changed:
            updated += 1
    db.commit()
    return {"updated": updated, "total": len(tickets)}


@router.post("/tickets")
def create_ticket(
    data: TicketCreate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    payload: dict = Depends(get_current_user_payload),
):
    ticket = ticket_repository.create(db, data, tenant_id)
    # Audit trail: registra l'username di chi ha creato il ticket
    username = payload.get("sub") or payload.get("username") or payload.get("email")
    if username:
        ticket.created_by = username
        db.commit()
    return _ticket_to_dict(ticket)


@router.patch("/tickets/bulk-status")
def bulk_update_status(data: BulkStatusUpdate, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id), payload: dict = Depends(get_current_user_payload)):
    if data.stato not in STATI_VALIDI:
        raise HTTPException(
            status_code=400,
            detail=f"Stato non valido: '{data.stato}'. Valori ammessi: {sorted(STATI_VALIDI)}",
        )
    if data.stato == "Pianificato" and not data.planned_start:
        raise HTTPException(status_code=400, detail="La data di inizio è obbligatoria per lo stato 'Pianificato'.")
    
    if data.stato == "Eliminato" and (not data.eliminazione_note or len(data.eliminazione_note) < 5):
        raise HTTPException(status_code=400, detail="Il motivo dell'eliminazione è obbligatorio (min 5 caratteri).")

    tickets = db.query(Ticket).filter(
        Ticket.id.in_(data.ids),
        Ticket.tenant_id == tenant_id,
    ).all()

    deleted_at = datetime.now(timezone.utc) if data.stato == "Eliminato" else None

    for ticket in tickets:
        ticket.stato = data.stato
        if data.asset_stato and ticket.asset:
            ticket.asset.stato = data.asset_stato

        if data.stato == "Pianificato":
            ticket.planned_start = data.planned_start
            ticket.planned_finish = data.planned_finish or (
                data.planned_start + timedelta(hours=float(ticket.durata_stimata_ore or 1.0))
            )
            if data.is_manual_plan is not None:
                ticket.is_manual_plan = data.is_manual_plan
            ticket.deleted_at = None
        elif data.stato == "Aperto":
            ticket.planned_start = None
            ticket.planned_finish = None
            ticket.is_manual_plan = False
            ticket.deleted_at = None
        elif data.stato == "Eliminato":
            ticket.eliminazione_note = data.eliminazione_note
            if ticket.deleted_at is None:
                ticket.deleted_at = deleted_at
        else:
            if data.planned_start:
                ticket.planned_start = data.planned_start
            if data.planned_finish:
                ticket.planned_finish = data.planned_finish
            if data.execution_start:
                ticket.execution_start = data.execution_start
            if data.execution_finish:
                ticket.execution_finish = data.execution_finish
            if data.is_manual_plan is not None:
                ticket.is_manual_plan = data.is_manual_plan
            ticket.deleted_at = None

    updated = len(tickets)

    if data.stato == "Eliminato":
        username = payload.get("sub") or payload.get("username") or "sistema"
        log_to_db("WARNING", "TICKETS", f"Bulk DELETE: {updated} ticket eliminati da '{username}'. Motivo: {data.eliminazione_note}", tenant_id=tenant_id)
    
    db.commit()
    return {"updated": updated, "stato": data.stato}


@router.patch("/tickets/{ticket_id}")
def patch_ticket(
    ticket_id: int,
    data: TicketUpdate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    payload: dict = Depends(get_current_user_payload),
):
    """PATCH parziale per singolo ticket (usato da Kanban e aggiornamenti veloci)."""
    ticket_orm = ticket_repository.get_by_id(db, ticket_id, tenant_id)
    if not ticket_orm:
        raise AppError(status_code=404, message=f"Ticket {ticket_id} non trovato")

    _validate_ticket_update(data, ticket_orm)

    # Validazione transizione a Pianificato
    if data.stato == "Pianificato":
        if not data.planned_start and not ticket_orm.planned_start:
            raise HTTPException(status_code=400, detail="Pianificazione mancante: inserire data inizio.")

    # Validazione eliminazione
    if data.stato == "Eliminato":
        if not data.eliminazione_note or len(data.eliminazione_note) < 5:
            raise HTTPException(status_code=400, detail="Il motivo dell'eliminazione è obbligatorio (min 5 caratteri).")

    _validate_planning_capacity(db, data, ticket_orm, tenant_id)

    result = ticket_repository.update(db, ticket_id, data, tenant_id)

    if data.stato == "Eliminato":
        username = payload.get("sub") or payload.get("username") or "sistema"
        log_to_db("WARNING", "TICKETS", f"Ticket #{ticket_id} eliminato da '{username}'. Motivo: {data.eliminazione_note}", tenant_id=tenant_id)

    if data.stato == "Chiuso":
        _aggiorna_scadenza_piano(db, ticket_orm)
        username = payload.get("sub") or payload.get("username") or "sistema"
        ticket_orm.closed_by = username
        db.commit()

    return result


@router.put("/tickets/{ticket_id}")
def update_ticket(
    ticket_id: int,
    data: TicketUpdate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    payload: dict = Depends(get_current_user_payload),
):
    ticket_orm = ticket_repository.get_by_id(db, ticket_id, tenant_id)
    if not ticket_orm:
        raise AppError(status_code=404, message=f"Ticket {ticket_id} non trovato")

    _validate_ticket_update(data, ticket_orm)

    # Validazione transizione a Pianificato
    if data.stato == "Pianificato":
        if not data.planned_start and not ticket_orm.planned_start:
            raise HTTPException(status_code=400, detail="Pianificazione mancante: inserire data inizio.")

    # Validazione eliminazione
    if data.stato == "Eliminato":
        if not data.eliminazione_note or len(data.eliminazione_note) < 5:
            raise HTTPException(status_code=400, detail="Il motivo dell'eliminazione è obbligatorio (min 5 caratteri).")

    _validate_planning_capacity(db, data, ticket_orm, tenant_id)

    result = ticket_repository.update(db, ticket_id, data, tenant_id)

    if data.stato == "Eliminato":
        username = payload.get("sub") or payload.get("username") or "sistema"
        log_to_db("WARNING", "TICKETS", f"Ticket #{ticket_id} eliminato da '{username}'. Motivo: {data.eliminazione_note}", tenant_id=tenant_id)

    if data.stato == "Chiuso":
        _aggiorna_scadenza_piano(db, ticket_orm)
        username = payload.get("sub") or payload.get("username") or "sistema"
        ticket_orm.closed_by = username
        db.commit()

    return result


import io
import csv
from fastapi.responses import StreamingResponse

@router.get("/export/tickets")
@limiter.limit("5/minute")
def export_tickets_csv(request: Request, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    data = ticket_repository.get_paginated(db, tenant_id=tenant_id, page=1, limit=10000)
    items = data.get("items", [])

    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')
    writer.writerow(["ID", "Titolo", "Asset ID", "Asset Nome", "Priorita", "Stato", "Tipo",
                     "Durata Stimata", "Tecnico ID", "Inizio Pianificato", "Fine Pianificata"])
    for t in items:
        writer.writerow([
            t.get("id"), t.get("titolo"), t.get("asset_id"), t.get("asset_name"),
            t.get("priorita"), t.get("stato"), t.get("tipo"),
            t.get("durata_stimata_ore"), t.get("tecnico_id"),
            t.get("planned_start"), t.get("planned_finish"),
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=maintai_tickets_export.csv"},
    )


import os
import uuid
from fastapi import UploadFile, File, HTTPException
from backend.db.modelli import TicketAllegato
from backend.core import storage

@router.post("/tickets/{ticket_id}/allegati")
@limiter.limit("10/minute")
async def upload_ticket_allegato(request: Request, ticket_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")

    ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
    if ext and ext not in ALLOWED_UPLOAD_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo file non consentito: '{ext}'. Estensioni ammesse: {', '.join(sorted(ALLOWED_UPLOAD_EXTENSIONS))}",
        )
    unique_filename = f"{uuid.uuid4()}{ext}"
    content = await file.read()
    if len(content) > MAX_ALLEGATO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File troppo grande: massimo {MAX_ALLEGATO_BYTES // (1024*1024)} MB consentiti.",
        )
    url = storage.save_file(content, unique_filename)

    allegato = TicketAllegato(
        ticket_id=ticket_id,
        nome_file=file.filename or unique_filename,
        percorso=url,
        tipo_mime=file.content_type,
        dimensione_bytes=len(content),
        tenant_id=tenant_id,
    )
    db.add(allegato)
    db.commit()
    db.refresh(allegato)

    return {"id": allegato.id, "nome_file": allegato.nome_file, "url": allegato.percorso, "tipo_mime": allegato.tipo_mime}

@router.get("/tickets/{ticket_id}/allegati")
def get_ticket_allegati(ticket_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    allegati = db.query(TicketAllegato).filter(
        TicketAllegato.ticket_id == ticket_id,
        TicketAllegato.tenant_id == tenant_id
    ).all()
    return [
        {"id": a.id, "nome_file": a.nome_file, "url": a.percorso, "tipo_mime": a.tipo_mime,
         "creato_il": a.creato_il.isoformat() if a.creato_il else None}
        for a in allegati
    ]

import base64
import binascii

@router.post("/tickets/{ticket_id}/firma")
async def upload_ticket_firma(ticket_id: int, data: dict, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    ticket = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == tenant_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")

    base64_str = data.get("image")
    if not base64_str:
        raise HTTPException(status_code=400, detail="Immagine firma mancante")
    if "," in base64_str:
        base64_str = base64_str.split(",")[1]

    filename = f"firma_{ticket_id}_{uuid.uuid4().hex[:8]}.png"
    try:
        content = base64.b64decode(base64_str, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Formato firma non valido")

    if not content:
        raise HTTPException(status_code=400, detail="Immagine firma vuota")
    if len(content) > MAX_FIRMA_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Firma troppo grande: massimo {MAX_FIRMA_BYTES // (1024*1024)} MB consentiti.",
        )

    url = storage.save_file(content, filename)

    ticket.firma_percorso = url
    db.commit()
    return {"url": ticket.firma_percorso}


