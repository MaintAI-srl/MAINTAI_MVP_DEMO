"""
Magazzino Ricambi — CRUD anagrafica, movimenti di magazzino e ricambi per ticket.

Registrato sotto il modulo `spare_parts` (attivabile/disattivabile). Tutte le
query filtrano per tenant_id. La disponibilità è giacenza - prenotato, dove
prenotato = quantità impegnata dai ticket Pianificato/In corso.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.exceptions import AppError
from backend.core.logger_db import db_info
from backend.core.security import (
    get_current_tenant_id,
    get_current_user_payload,
    require_roles,
)
from backend.db.modelli import MovimentoRicambio, Ricambio, Ticket, TicketRicambio
from backend.schemas.ricambi import (
    MovimentoCreate,
    RicambioCreate,
    RicambioUpdate,
    TicketRicambioCreate,
)
from backend.services import ricambi_service

router = APIRouter(tags=["ricambi"])


def _tenant_or_400(tenant_id: Optional[int]) -> int:
    if tenant_id is None:
        raise AppError(status_code=400, message="Seleziona un cliente (contesto tenant) per il magazzino ricambi.")
    return tenant_id


def _serialize(r: Ricambio, avail: Dict[int, Dict[str, float]]) -> Dict[str, Any]:
    a = avail.get(r.id, {})
    giacenza = float(r.giacenza or 0)
    prenotato = float(a.get("prenotato", 0.0))
    disponibile = float(a.get("disponibile", giacenza))
    scorta_minima = float(r.scorta_minima or 0)
    return {
        "id": r.id,
        "codice": r.codice,
        "descrizione": r.descrizione,
        "categoria": r.categoria,
        "unita_misura": r.unita_misura,
        "giacenza": giacenza,
        "scorta_minima": scorta_minima,
        "prezzo_unitario": r.prezzo_unitario,
        "fornitore": r.fornitore,
        "ubicazione": r.ubicazione,
        "note": r.note,
        "attivo": bool(r.attivo),
        "prenotato": round(prenotato, 3),
        "disponibile": round(disponibile, 3),
        "sotto_scorta": disponibile < scorta_minima if scorta_minima else False,
        "created_at": r.created_at,
    }


def _get_ricambio(db: Session, tenant_id: int, ricambio_id: int) -> Ricambio:
    r = (
        db.query(Ricambio)
        .filter(Ricambio.id == ricambio_id, Ricambio.tenant_id == tenant_id)
        .first()
    )
    if not r:
        raise HTTPException(status_code=404, detail="Ricambio non trovato.")
    return r


# ── Anagrafica ricambi ────────────────────────────────────────────────────────

@router.get("/ricambi")
def list_ricambi(
    solo_attivi: bool = False,
    sotto_scorta: bool = False,
    tenant_id: Optional[int] = Depends(get_current_tenant_id),
    db: Session = Depends(get_db),
    _payload: dict = Depends(get_current_user_payload),
):
    tid = _tenant_or_400(tenant_id)
    q = db.query(Ricambio).filter(Ricambio.tenant_id == tid)
    if solo_attivi:
        q = q.filter(Ricambio.attivo.is_(True))
    ricambi = q.order_by(Ricambio.codice.asc()).all()
    avail = ricambi_service.availability_map(db, tid)
    items = [_serialize(r, avail) for r in ricambi]
    if sotto_scorta:
        items = [i for i in items if i["sotto_scorta"]]
    return {"ricambi": items, "totale": len(items)}


@router.post("/ricambi")
def create_ricambio(
    data: RicambioCreate,
    tenant_id: Optional[int] = Depends(get_current_tenant_id),
    db: Session = Depends(get_db),
    payload: dict = Depends(require_roles("responsabile")),
):
    tid = _tenant_or_400(tenant_id)
    exists = (
        db.query(Ricambio)
        .filter(Ricambio.tenant_id == tid, Ricambio.codice.ilike(data.codice.strip()))
        .first()
    )
    if exists:
        raise HTTPException(status_code=409, detail=f"Esiste già un ricambio con codice '{data.codice}'.")
    r = Ricambio(
        tenant_id=tid,
        codice=data.codice.strip(),
        descrizione=data.descrizione.strip(),
        categoria=data.categoria,
        unita_misura=data.unita_misura or "pz",
        giacenza=float(data.giacenza or 0),
        scorta_minima=float(data.scorta_minima or 0),
        prezzo_unitario=data.prezzo_unitario,
        fornitore=data.fornitore,
        ubicazione=data.ubicazione,
        note=data.note,
        attivo=data.attivo,
    )
    db.add(r)
    db.commit()
    db.refresh(r)
    # Movimento iniziale di carico se giacenza > 0 (tracciabilità)
    if r.giacenza and r.giacenza > 0:
        ricambi_service.register_movimento(
            db, tid, r, "carico", r.giacenza,
            causale="Giacenza iniziale", utente=payload.get("sub"), commit=True,
        )
    db_info(db, "RICAMBI", f"Creato ricambio {r.codice} (#{r.id})", tenant_id=tid)
    avail = ricambi_service.availability_map(db, tid)
    return _serialize(r, avail)


@router.put("/ricambi/{ricambio_id}")
def update_ricambio(
    ricambio_id: int,
    data: RicambioUpdate,
    tenant_id: Optional[int] = Depends(get_current_tenant_id),
    db: Session = Depends(get_db),
    _payload: dict = Depends(require_roles("responsabile")),
):
    tid = _tenant_or_400(tenant_id)
    r = _get_ricambio(db, tid, ricambio_id)
    updates = data.model_dump(exclude_unset=True)
    if "codice" in updates and updates["codice"]:
        dup = (
            db.query(Ricambio)
            .filter(
                Ricambio.tenant_id == tid,
                Ricambio.codice.ilike(updates["codice"].strip()),
                Ricambio.id != ricambio_id,
            )
            .first()
        )
        if dup:
            raise HTTPException(status_code=409, detail=f"Codice '{updates['codice']}' già in uso.")
    # La giacenza NON si modifica qui: solo tramite movimenti (audit trail).
    for field, value in updates.items():
        setattr(r, field, value.strip() if isinstance(value, str) else value)
    db.commit()
    db.refresh(r)
    avail = ricambi_service.availability_map(db, tid)
    return _serialize(r, avail)


@router.delete("/ricambi/{ricambio_id}")
def delete_ricambio(
    ricambio_id: int,
    tenant_id: Optional[int] = Depends(get_current_tenant_id),
    db: Session = Depends(get_db),
    _payload: dict = Depends(require_roles("responsabile")),
):
    tid = _tenant_or_400(tenant_id)
    r = _get_ricambio(db, tid, ricambio_id)
    # Soft delete: disattiva (conserva lo storico movimenti/righe ticket).
    r.attivo = False
    db.commit()
    return {"success": True, "message": f"Ricambio '{r.codice}' disattivato."}


# ── Movimenti di magazzino ────────────────────────────────────────────────────

@router.post("/ricambi/{ricambio_id}/movimento")
def create_movimento(
    ricambio_id: int,
    data: MovimentoCreate,
    tenant_id: Optional[int] = Depends(get_current_tenant_id),
    db: Session = Depends(get_db),
    payload: dict = Depends(require_roles("responsabile")),
):
    tid = _tenant_or_400(tenant_id)
    r = _get_ricambio(db, tid, ricambio_id)
    mov = ricambi_service.register_movimento(
        db, tid, r, data.tipo, data.quantita,
        causale=data.causale, utente=payload.get("sub"),
        ticket_id=data.ticket_id, commit=True,
    )
    avail = ricambi_service.availability_map(db, tid)
    return {"movimento_id": mov.id, "ricambio": _serialize(r, avail)}


@router.get("/ricambi/{ricambio_id}/movimenti")
def list_movimenti(
    ricambio_id: int,
    tenant_id: Optional[int] = Depends(get_current_tenant_id),
    db: Session = Depends(get_db),
    _payload: dict = Depends(get_current_user_payload),
):
    tid = _tenant_or_400(tenant_id)
    _get_ricambio(db, tid, ricambio_id)
    movimenti = (
        db.query(MovimentoRicambio)
        .filter(MovimentoRicambio.tenant_id == tid, MovimentoRicambio.ricambio_id == ricambio_id)
        .order_by(MovimentoRicambio.created_at.desc())
        .limit(200)
        .all()
    )
    return {
        "movimenti": [
            {
                "id": m.id,
                "tipo": m.tipo,
                "quantita": m.quantita,
                "giacenza_dopo": m.giacenza_dopo,
                "causale": m.causale,
                "utente": m.utente,
                "ticket_id": m.ticket_id,
                "created_at": m.created_at,
            }
            for m in movimenti
        ]
    }


# ── Ricambi di un ticket (il "+ ricambi") ─────────────────────────────────────

def _get_ticket(db: Session, tenant_id: int, ticket_id: int) -> Ticket:
    t = db.query(Ticket).filter(Ticket.id == ticket_id, Ticket.tenant_id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket non trovato.")
    return t


@router.get("/tickets/{ticket_id}/ricambi")
def get_ticket_ricambi(
    ticket_id: int,
    tenant_id: Optional[int] = Depends(get_current_tenant_id),
    db: Session = Depends(get_db),
    _payload: dict = Depends(get_current_user_payload),
):
    tid = _tenant_or_400(tenant_id)
    _get_ticket(db, tid, ticket_id)
    return ricambi_service.ticket_ricambi_status(db, tid, ticket_id)


@router.post("/tickets/{ticket_id}/ricambi")
def add_ticket_ricambio(
    ticket_id: int,
    data: TicketRicambioCreate,
    tenant_id: Optional[int] = Depends(get_current_tenant_id),
    db: Session = Depends(get_db),
    _payload: dict = Depends(get_current_user_payload),
):
    tid = _tenant_or_400(tenant_id)
    _get_ticket(db, tid, ticket_id)

    ricambio: Optional[Ricambio] = None
    is_nuovo = False
    descrizione = (data.descrizione or "").strip() or None

    if data.ricambio_id is not None:
        ricambio = _get_ricambio(db, tid, data.ricambio_id)
        if not descrizione:
            descrizione = ricambio.descrizione
    else:
        # Ricambio nuovo non a catalogo → blocca la pianificazione (proposta d'acquisto)
        is_nuovo = True
        if not descrizione:
            raise HTTPException(status_code=400, detail="Per un ricambio nuovo indica una descrizione.")

    row = TicketRicambio(
        tenant_id=tid,
        ticket_id=ticket_id,
        ricambio_id=ricambio.id if ricambio else None,
        descrizione=descrizione,
        quantita=float(data.quantita),
        is_nuovo=is_nuovo,
        stato_acquisto="da_ordinare" if is_nuovo else None,
    )
    db.add(row)
    db.commit()
    return ricambi_service.ticket_ricambi_status(db, tid, ticket_id)


@router.delete("/tickets/{ticket_id}/ricambi/{row_id}")
def delete_ticket_ricambio(
    ticket_id: int,
    row_id: int,
    tenant_id: Optional[int] = Depends(get_current_tenant_id),
    db: Session = Depends(get_db),
    _payload: dict = Depends(get_current_user_payload),
):
    tid = _tenant_or_400(tenant_id)
    row = (
        db.query(TicketRicambio)
        .filter(
            TicketRicambio.id == row_id,
            TicketRicambio.ticket_id == ticket_id,
            TicketRicambio.tenant_id == tid,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Riga ricambio non trovata.")
    db.delete(row)
    db.commit()
    return ricambi_service.ticket_ricambi_status(db, tid, ticket_id)
