import math
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.db.modelli import PianoManutenzione, Ticket
from backend.schemas.piano_manutenzione import PianoManutenzioneCreate, PianoManutenzioneUpdate, PianoManutenzioneResponse

router = APIRouter()

@router.get("/piani-manutenzione")
def list_piani_manutenzione(
    asset_id: Optional[int] = Query(None),
    stato: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id)
):
    query = db.query(PianoManutenzione).filter(PianoManutenzione.tenant_id == tenant_id)
    if asset_id is not None:
        query = query.filter(PianoManutenzione.asset_id == asset_id)
    if stato:
        query = query.filter(PianoManutenzione.stato == stato)
    
    total = query.count()
    items = query.order_by(PianoManutenzione.id.desc()).offset((page - 1) * limit).limit(limit).all()
    
    return {
        "items": items,
        "total": total,
        "page": page,
        "pages": max(1, math.ceil(total / limit))
    }

@router.post("/piani-manutenzione", response_model=PianoManutenzioneResponse)
def create_piano(
    data: PianoManutenzioneCreate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id)
):
    # Verify uniqueness of nome_codificato per tenant, though non strict
    exist = db.query(PianoManutenzione).filter(
        PianoManutenzione.nome_codificato == data.nome_codificato,
        PianoManutenzione.tenant_id == tenant_id
    ).first()
    if exist:
        raise HTTPException(status_code=400, detail="Codice piano già esistente per questo tenant")

    piano = PianoManutenzione(
        tenant_id=tenant_id,
        nome_codificato=data.nome_codificato,
        progressivo=data.progressivo,
        descrizione=data.descrizione,
        stato=data.stato,
        asset_id=data.asset_id,
        impianto_id=data.impianto_id,
        sito_id=data.sito_id,
        manuale_id=data.manuale_id
    )
    db.add(piano)
    db.commit()
    db.refresh(piano)
    return piano

@router.get("/piani-manutenzione/{piano_id}", response_model=PianoManutenzioneResponse)
def get_piano(
    piano_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id)
):
    piano = db.query(PianoManutenzione).filter(
        PianoManutenzione.id == piano_id,
        PianoManutenzione.tenant_id == tenant_id
    ).first()
    if not piano:
        raise HTTPException(status_code=404, detail="Piano non trovato")
    return piano

@router.put("/piani-manutenzione/{piano_id}", response_model=PianoManutenzioneResponse)
def update_piano(
    piano_id: int,
    data: PianoManutenzioneUpdate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id)
):
    piano = db.query(PianoManutenzione).filter(
        PianoManutenzione.id == piano_id,
        PianoManutenzione.tenant_id == tenant_id
    ).first()
    if not piano:
        raise HTTPException(status_code=404, detail="Piano non trovato")
    
    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(piano, k, v)
    
    db.commit()
    db.refresh(piano)
    return piano

@router.delete("/piani-manutenzione/{piano_id}")
def delete_piano(
    piano_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id)
):
    piano = db.query(PianoManutenzione).filter(
        PianoManutenzione.id == piano_id,
        PianoManutenzione.tenant_id == tenant_id
    ).first()
    if not piano:
        raise HTTPException(status_code=404, detail="Piano non trovato")
    
    # Quando elimino il piano, non elimino i ticket, ma rimuovo l'aggregazione
    db.query(Ticket).filter(
        Ticket.piano_manutenzione_id == piano_id,
        Ticket.tenant_id == tenant_id
    ).update({"piano_manutenzione_id": None})
    
    db.delete(piano)
    db.commit()
    return {"deleted": piano_id}

@router.post("/piani-manutenzione/{piano_id}/ticket")
def assign_ticket_to_piano(
    piano_id: int,
    ticket_id: int,
    origine: str = Query("manuale_interno_piano"),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id)
):
    """
    Collega un ticket esistente al piano di manutenzione prescelto.
    Possibili origini: 'manuale', 'excel', 'manuale_interno_piano'
    """
    piano = db.query(PianoManutenzione).filter(
        PianoManutenzione.id == piano_id,
        PianoManutenzione.tenant_id == tenant_id
    ).first()
    if not piano:
        raise HTTPException(status_code=404, detail="Piano non trovato")

    ticket = db.query(Ticket).filter(
        Ticket.id == ticket_id,
        Ticket.tenant_id == tenant_id
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")

    ticket.piano_manutenzione_id = piano_id
    ticket.origine_piano = origine
    db.commit()
    
    return {"success": True, "ticket_id": ticket_id, "piano_id": piano_id}
