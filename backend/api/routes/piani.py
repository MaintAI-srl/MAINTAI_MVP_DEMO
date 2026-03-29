import math

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional

from backend.core.dependencies import get_db
from backend.db.modelli import AttivitaManutenzione, Asset, Ticket
from backend.api.routes.scheduler import run_scheduler_and_persist

router = APIRouter()


class AttivitaUpdate(BaseModel):
    descrizione: Optional[str] = None
    frequenza_giorni: Optional[int] = None
    durata_ore: Optional[float] = None
    priorita: Optional[str] = None
    asset_id: Optional[int] = None


class GeneraTicketRequest(BaseModel):
    attivita_ids: list[int]


def _to_dict(a: AttivitaManutenzione, asset_name: str | None, ticket_id: int | None = None) -> dict:
    return {
        "id": a.id,
        "descrizione": a.descrizione,
        "frequenza_giorni": a.frequenza_giorni,
        "durata_ore": a.durata_ore,
        "priorita": a.priorita,
        "asset_id": a.asset_id,
        "asset_name": asset_name or "",
        "manuale_id": a.manuale_id,
        "origine": a.origine or "",
        "ticket_id": ticket_id,
    }


@router.get("/piani")
def list_piani(
    asset_id: Optional[int] = Query(None),
    priorita: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(AttivitaManutenzione)
    if asset_id is not None:
        query = query.filter(AttivitaManutenzione.asset_id == asset_id)
    if priorita:
        query = query.filter(AttivitaManutenzione.priorita == priorita)

    total = query.count()
    attivita = (
        query.order_by(AttivitaManutenzione.id.desc())
        .offset((page - 1) * limit)
        .limit(limit)
        .all()
    )

    # Build asset name map
    asset_ids = {a.asset_id for a in attivita if a.asset_id}
    assets_map = {a.id: a.nome for a in db.query(Asset).filter(Asset.id.in_(asset_ids)).all()}

    # Build map: attivita_id → ticket_id
    att_ids = [a.id for a in attivita]
    tickets_rows = (
        db.query(Ticket.attivita_manutenzione_id, Ticket.id)
        .filter(Ticket.attivita_manutenzione_id.in_(att_ids))
        .all()
    )
    ticket_map: dict[int, int] = {row[0]: row[1] for row in tickets_rows}

    return {
        "items": [_to_dict(a, assets_map.get(a.asset_id), ticket_map.get(a.id)) for a in attivita],
        "total": total,
        "page": page,
        "pages": max(1, math.ceil(total / limit)),
    }


@router.put("/piani/{attivita_id}")
def update_attivita(attivita_id: int, data: AttivitaUpdate, db: Session = Depends(get_db)):
    att = db.query(AttivitaManutenzione).filter(AttivitaManutenzione.id == attivita_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="Attività non trovata")

    if data.descrizione is not None:
        att.descrizione = data.descrizione
    if data.frequenza_giorni is not None:
        att.frequenza_giorni = data.frequenza_giorni
    if data.durata_ore is not None:
        att.durata_ore = data.durata_ore
    if data.priorita is not None:
        att.priorita = data.priorita
    if data.asset_id is not None:
        att.asset_id = data.asset_id

    db.commit()
    db.refresh(att)

    asset_name = None
    if att.asset_id:
        asset = db.query(Asset).filter(Asset.id == att.asset_id).first()
        asset_name = asset.nome if asset else None

    existing_ticket = db.query(Ticket).filter(Ticket.attivita_manutenzione_id == att.id).first()
    return _to_dict(att, asset_name, existing_ticket.id if existing_ticket else None)


@router.post("/piani/genera-ticket")
def genera_ticket(data: GeneraTicketRequest, db: Session = Depends(get_db)):
    """Genera ticket per le attività indicate, saltando quelle già convertite."""
    created = []
    skipped = []

    for att_id in data.attivita_ids:
        # skip if ticket already exists for this activity
        existing = db.query(Ticket).filter(Ticket.attivita_manutenzione_id == att_id).first()
        if existing:
            skipped.append(att_id)
            continue

        att = db.query(AttivitaManutenzione).filter(AttivitaManutenzione.id == att_id).first()
        if not att:
            skipped.append(att_id)
            continue

        durata = float(att.durata_ore) if att.durata_ore else 1.0
        
        ore_rimanenti = durata
        chunk_idx = 1
        num_chunks = int(ore_rimanenti // 8) + (1 if ore_rimanenti % 8 > 0 else 0)

        while ore_rimanenti > 0:
            durata_chunk = min(8.0, ore_rimanenti)
            titolo_base = att.descrizione[:120] if att.descrizione else f"Attività #{att_id}"
            if num_chunks > 1:
                titolo = f"{titolo_base} (Parte {chunk_idx}/{num_chunks})"
            else:
                titolo = titolo_base

            ticket = Ticket(
                titolo=titolo,
                asset_id=att.asset_id,
                tipo="PM",
                priorita=att.priorita or "Media",
                stato="Aperto",
                durata_stimata_ore=durata_chunk,
                fascia_oraria="diurna",
                descrizione=att.descrizione or "",
                attivita_manutenzione_id=att_id,
            )
            db.add(ticket)
            db.flush()
            
            if chunk_idx == 1:
                created.append({"attivita_id": att_id, "ticket_id": ticket.id, "titolo": ticket.titolo})
                
            ore_rimanenti -= durata_chunk
            chunk_idx += 1

    db.commit()

    # Auto-pianificazione: esegui scheduler e persisti planned_start/planned_finish
    if created:
        try:
            run_scheduler_and_persist(db)
        except Exception as exc:
            # Non bloccare la risposta se lo scheduler fallisce
            print(f">>> SCHEDULER AUTO ERROR: {exc}")

    return {
        "created": len(created),
        "skipped": len(skipped),
        "tickets": created,
    }

import io
import csv
from fastapi.responses import StreamingResponse

@router.get("/piani/export")
def export_piani(db: Session = Depends(get_db)):
    attivita = db.query(AttivitaManutenzione).join(Asset).all()
    
    output = io.StringIO()
    writer = csv.writer(output, delimiter=';')
    
    # Header
    writer.writerow(["ID", "Descrizione", "Asset", "Frequenza (gg)", "Durata (h)", "Priorita", "Origine"])
    
    # Righe
    for a in attivita:
        writer.writerow([
            a.id,
            a.descrizione,
            a.asset.nome if a.asset else "N/A",
            a.frequenza_giorni,
            a.durata_ore,
            a.priorita,
            a.origine or "Manuale"
        ])
    
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=piano_manutenzione_maintai.csv"}
    )
