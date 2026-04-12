import math
import io
import csv
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id, check_tenant_ownership
from backend.db.modelli import AttivitaManutenzione, Asset, Ticket

router = APIRouter()


class AttivitaCreate(BaseModel):
    descrizione: str
    nome: Optional[str] = None
    frequenza_giorni: Optional[int] = None
    durata_ore: Optional[float] = None
    priorita: str = "Media"
    asset_id: Optional[int] = None
    codice: Optional[str] = None
    generation_mode: Optional[str] = "manual"
    generate_days_before_due: Optional[int] = 7
    source_type: Optional[str] = "manual_task"


class AttivitaUpdate(BaseModel):
    descrizione: Optional[str] = None
    nome: Optional[str] = None
    frequenza_giorni: Optional[int] = None
    durata_ore: Optional[float] = None
    priorita: Optional[str] = None
    asset_id: Optional[int] = None
    codice: Optional[str] = None
    generation_mode: Optional[str] = None
    generate_days_before_due: Optional[int] = None
    task_stato: Optional[str] = None


class GeneraTicketRequest(BaseModel):
    attivita_ids: list[int]


def _compute_next_due(att: AttivitaManutenzione) -> Optional[datetime]:
    """Calcola la prossima scadenza basandosi su last_generated_at o ultima_esecuzione."""
    if not att.frequenza_giorni:
        return None
    base = att.last_generated_at or att.ultima_esecuzione
    if not base:
        return None
    return base + timedelta(days=att.frequenza_giorni)


def _to_dict(a: AttivitaManutenzione, asset_name: str | None, ticket_id: int | None = None, open_ticket_count: int = 0) -> dict:
    next_due = _compute_next_due(a)
    return {
        "id": a.id,
        "piano_id": getattr(a, "piano_id", None),
        "nome": getattr(a, "nome", None),
        "descrizione": a.descrizione,
        "frequenza_giorni": a.frequenza_giorni,
        "durata_ore": a.durata_ore,
        "priorita": a.priorita,
        "asset_id": a.asset_id,
        "asset_name": asset_name or "",
        "manuale_id": a.manuale_id,
        "origine": a.origine or "",
        "ticket_id": ticket_id,
        "open_ticket_count": open_ticket_count,
        "codice": getattr(a, "codice", None),
        "generation_mode": getattr(a, "generation_mode", "manual") or "manual",
        "generate_days_before_due": getattr(a, "generate_days_before_due", 7),
        "task_stato": getattr(a, "task_stato", "active") or "active",
        "source_type": getattr(a, "source_type", None),
        "last_generated_at": a.last_generated_at.isoformat() if a.last_generated_at else None,
        "next_due_at": next_due.isoformat() if next_due else (a.prossima_scadenza.isoformat() if a.prossima_scadenza else None),
        "ultima_esecuzione": a.ultima_esecuzione.isoformat() if a.ultima_esecuzione else None,
    }


@router.get("/piani")
def list_piani(
    asset_id: Optional[int] = Query(None),
    piano_id: Optional[int] = Query(None),
    priorita: Optional[str] = Query(None),
    task_stato: Optional[str] = Query(None),
    source_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    query = db.query(AttivitaManutenzione).filter(AttivitaManutenzione.tenant_id == tenant_id)
    if asset_id is not None:
        query = query.filter(AttivitaManutenzione.asset_id == asset_id)
    if piano_id is not None:
        query = query.filter(AttivitaManutenzione.piano_id == piano_id)
    if priorita:
        query = query.filter(AttivitaManutenzione.priorita == priorita)
    if task_stato:
        query = query.filter(AttivitaManutenzione.task_stato == task_stato)
    if source_type:
        query = query.filter(AttivitaManutenzione.source_type == source_type)

    total = query.count()
    attivita = query.order_by(AttivitaManutenzione.id.desc()).offset((page - 1) * limit).limit(limit).all()

    asset_ids = {a.asset_id for a in attivita if a.asset_id}
    assets_map = {a.id: a.nome for a in db.query(Asset).filter(Asset.id.in_(asset_ids)).all()}

    att_ids = [a.id for a in attivita]
    # Recupera ticket attivi (non eliminati, non chiusi) per ogni task
    tickets_rows = (
        db.query(Ticket.attivita_manutenzione_id, Ticket.id, Ticket.stato)
        .filter(
            Ticket.attivita_manutenzione_id.in_(att_ids),
            Ticket.deleted_at.is_(None),
        )
        .all()
    )
    # Il ticket_id "principale" è il più recente attivo; open_ticket_count conta quelli aperti
    ticket_latest: dict[int, int] = {}
    open_count: dict[int, int] = {}
    for row in tickets_rows:
        att_id, t_id, stato = row
        if att_id not in ticket_latest:
            ticket_latest[att_id] = t_id
        if stato not in ("Chiuso", "Eliminato"):
            open_count[att_id] = open_count.get(att_id, 0) + 1

    return {
        "items": [
            _to_dict(a, assets_map.get(a.asset_id), ticket_latest.get(a.id), open_count.get(a.id, 0))
            for a in attivita
        ],
        "total": total,
        "page": page,
        "pages": max(1, math.ceil(total / limit)),
    }


@router.get("/piani/{attivita_id}/tickets")
def get_task_tickets(
    attivita_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Restituisce lo storico di tutti i ticket generati da un task."""
    att = db.query(AttivitaManutenzione).filter(
        AttivitaManutenzione.id == attivita_id,
        AttivitaManutenzione.tenant_id == tenant_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Task non trovato")

    tickets = (
        db.query(Ticket)
        .filter(
            Ticket.attivita_manutenzione_id == attivita_id,
            Ticket.deleted_at.is_(None),
        )
        .order_by(Ticket.created_at.desc())
        .all()
    )

    return [
        {
            "id": t.id,
            "titolo": t.titolo,
            "stato": t.stato,
            "priorita": t.priorita,
            "durata_stimata_ore": t.durata_stimata_ore,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "planned_start": t.planned_start.isoformat() if t.planned_start else None,
            "tecnico_id": t.tecnico_id,
        }
        for t in tickets
    ]


@router.post("/piani")
def create_attivita(
    data: AttivitaCreate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Crea un task di manutenzione manualmente."""
    if data.asset_id:
        check_tenant_ownership(db, Asset, data.asset_id, tenant_id)

    att = AttivitaManutenzione(
        nome=data.nome,
        descrizione=data.descrizione,
        frequenza_giorni=data.frequenza_giorni,
        durata_ore=data.durata_ore,
        priorita=data.priorita,
        asset_id=data.asset_id,
        codice=data.codice,
        origine="Manuale",
        manuale_id=None,
        tenant_id=tenant_id,
        generation_mode=data.generation_mode or "manual",
        generate_days_before_due=data.generate_days_before_due or 7,
        task_stato="active",
        source_type=data.source_type or "manual_task",
    )
    db.add(att)
    db.commit()
    db.refresh(att)

    asset_name = None
    if att.asset_id:
        asset = db.query(Asset).filter(Asset.id == att.asset_id).first()
        asset_name = asset.nome if asset else None

    return _to_dict(att, asset_name)


@router.delete("/piani/{attivita_id}")
def delete_attivita(
    attivita_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Elimina un task (i ticket associati vengono scollegati, non eliminati)."""
    att = db.query(AttivitaManutenzione).filter(
        AttivitaManutenzione.id == attivita_id,
        AttivitaManutenzione.tenant_id == tenant_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Task non trovato")

    db.query(Ticket).filter(
        Ticket.attivita_manutenzione_id == attivita_id,
        Ticket.tenant_id == tenant_id,
    ).update({"attivita_manutenzione_id": None})

    db.delete(att)
    db.commit()
    return {"deleted": attivita_id}


@router.put("/piani/{attivita_id}")
def update_attivita(
    attivita_id: int,
    data: AttivitaUpdate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    att = db.query(AttivitaManutenzione).filter(
        AttivitaManutenzione.id == attivita_id,
        AttivitaManutenzione.tenant_id == tenant_id,
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="Task non trovato")

    for field in ("descrizione", "nome", "frequenza_giorni", "durata_ore", "priorita",
                  "codice", "generation_mode", "generate_days_before_due", "task_stato"):
        val = getattr(data, field, None)
        if val is not None:
            setattr(att, field, val)

    if data.asset_id is not None:
        if data.asset_id:
            check_tenant_ownership(db, Asset, data.asset_id, tenant_id)
        att.asset_id = data.asset_id

    db.commit()
    db.refresh(att)

    asset_name = None
    if att.asset_id:
        asset = db.query(Asset).filter(Asset.id == att.asset_id).first()
        asset_name = asset.nome if asset else None

    existing_ticket = db.query(Ticket).filter(
        Ticket.attivita_manutenzione_id == att.id,
        Ticket.deleted_at.is_(None),
    ).first()
    return _to_dict(att, asset_name, existing_ticket.id if existing_ticket else None)


@router.post("/piani/genera-ticket")
async def genera_ticket(
    data: GeneraTicketRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    from backend.api.routes.scheduler import run_scheduler_and_persist
    created = []
    skipped = []

    for att_id in data.attivita_ids:
        att = db.query(AttivitaManutenzione).filter(
            AttivitaManutenzione.id == att_id,
            AttivitaManutenzione.tenant_id == tenant_id,
        ).first()
        if not att:
            skipped.append(att_id)
            continue

        # Verifica se esiste già un ticket aperto/pianificato per questo task
        existing = db.query(Ticket).filter(
            Ticket.attivita_manutenzione_id == att_id,
            Ticket.stato.in_(["Aperto", "Pianificato", "In corso"]),
            Ticket.deleted_at.is_(None),
        ).first()
        if existing:
            skipped.append(att_id)
            continue

        durata = float(att.durata_ore) if att.durata_ore else 1.0
        ore_rimanenti = durata
        chunk_idx = 1
        num_chunks = int(ore_rimanenti // 8) + (1 if ore_rimanenti % 8 > 0 else 0)

        while ore_rimanenti > 0:
            durata_chunk = min(8.0, ore_rimanenti)
            titolo_base = att.nome or att.descrizione[:120] if att.descrizione else f"Task #{att_id}"
            if att.nome and att.descrizione and att.nome != att.descrizione:
                titolo_base = att.nome[:120]
            else:
                titolo_base = (att.descrizione or f"Task #{att_id}")[:120]
            titolo = f"{titolo_base} (Parte {chunk_idx}/{num_chunks})" if num_chunks > 1 else titolo_base

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
                tenant_id=tenant_id,
                origin_type="from_task",
            )
            db.add(ticket)
            db.flush()

            if chunk_idx == 1:
                created.append({"attivita_id": att_id, "ticket_id": ticket.id, "titolo": ticket.titolo})

            ore_rimanenti -= durata_chunk
            chunk_idx += 1

        # Aggiorna metadati del task
        att.last_generated_at = datetime.now(timezone.utc)
        if att.frequenza_giorni:
            att.next_due_at = datetime.now(timezone.utc) + timedelta(days=att.frequenza_giorni)

    db.commit()

    if created:
        try:
            await run_scheduler_and_persist(db, tenant_id=tenant_id)
        except Exception as exc:
            print(f">>> SCHEDULER AUTO ERROR: {exc}")

    return {"created": len(created), "skipped": len(skipped), "tickets": created}


@router.get("/piani/export")
def export_piani(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Esporta i task in CSV (autenticato via cookie)."""
    attivita = (
        db.query(AttivitaManutenzione)
        .filter(AttivitaManutenzione.tenant_id == tenant_id)
        .join(Asset, isouter=True)
        .limit(5000)
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output, delimiter=";")
    writer.writerow(["ID", "Codice", "Nome/Descrizione", "Asset", "Frequenza (gg)", "Durata (h)", "Priorita", "Modalita Generazione", "Stato Task", "Ultimo Ticket Generato", "Prossima Scadenza", "Origine"])
    for a in attivita:
        next_due = _compute_next_due(a)
        writer.writerow([
            a.id,
            getattr(a, "codice", "") or "",
            getattr(a, "nome", None) or a.descrizione,
            a.asset.nome if hasattr(a, "asset") and a.asset else "N/A",
            a.frequenza_giorni,
            a.durata_ore,
            a.priorita,
            getattr(a, "generation_mode", "manual") or "manual",
            getattr(a, "task_stato", "active") or "active",
            a.last_generated_at.isoformat() if a.last_generated_at else "",
            next_due.isoformat() if next_due else "",
            a.origine or "Manuale",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=task_manutenzione_maintai.csv"},
    )
