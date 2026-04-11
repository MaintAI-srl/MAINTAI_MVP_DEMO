import math
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func
import datetime
import json
import io
import csv

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
    # Generazione automatica progressivo se non fornito
    prog = data.progressivo
    if prog is None:
        max_prog = db.query(func.max(PianoManutenzione.progressivo)).filter(
            PianoManutenzione.tenant_id == tenant_id
        ).scalar()
        prog = (max_prog or 0) + 1

    # Generazione automatica nome_codificato se non fornito
    nome = data.nome_codificato
    if not nome:
        anno = datetime.datetime.now().year
        nome = f"PM-{anno}-{prog:03d}"

    # Verify uniqueness of nome_codificato per tenant
    exist = db.query(PianoManutenzione).filter(
        PianoManutenzione.nome_codificato == nome,
        PianoManutenzione.tenant_id == tenant_id
    ).first()
    if exist:
        # Se generato automaticamente e esiste, proviamo a incrementare finché non è unico
        if not data.nome_codificato:
            attempts = 0
            while exist and attempts < 100:
                prog += 1
                nome = f"PM-{anno}-{prog:03d}"
                exist = db.query(PianoManutenzione).filter(
                    PianoManutenzione.nome_codificato == nome,
                    PianoManutenzione.tenant_id == tenant_id
                ).first()
                attempts += 1
        else:
            raise HTTPException(status_code=400, detail="Codice piano già esistente per questo tenant")

    piano = PianoManutenzione(
        tenant_id=tenant_id,
        nome_codificato=nome,
        progressivo=prog,
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


@router.post("/piani-manutenzione/{piano_id}/import-pdf")
async def import_pdf_to_piano(
    piano_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id)
):
    """Importa attività da un PDF (con OCR fallback) e le aggiunge come ticket al piano."""
    from backend.services.pdf_service import smart_read_pdf
    from backend.services.ai.manuals_ai_service import parse_manual_with_ai
    
    piano = db.query(PianoManutenzione).filter(
        PianoManutenzione.id == piano_id,
        PianoManutenzione.tenant_id == tenant_id
    ).first()
    if not piano:
        raise HTTPException(status_code=404, detail="Piano non trovato")

    content = await file.read()
    result = smart_read_pdf(content)
    text = result.get("text", "")

    if not text.strip():
        raise HTTPException(status_code=422, detail="Nessun testo estratto dal PDF (anche con OCR).")

    parsed_json_str = parse_manual_with_ai(text, file.filename)
    try:
        parsed = json.loads(parsed_json_str)
    except Exception:
        raise HTTPException(status_code=500, detail="L'AI non ha restituito un formato valido.")

    plans = parsed.get("plans", [])
    created_count = 0
    
    # Priority map
    prio_map = {"high": "Alta", "medium": "Media", "low": "Bassa"}

    for plan in plans:
        # Frequenza giorni da label o parsing AI
        freg_days = None
        if plan.get("frequency"):
            freg_days = plan["frequency"].get("value")
            # simplificata
            unit = (plan["frequency"].get("unit") or "days").lower()
            if "week" in unit: freg_days = (freg_days or 1) * 7
            if "month" in unit: freg_days = (freg_days or 1) * 30
            if "year" in unit: freg_days = (freg_days or 1) * 365

        durata = plan.get("estimated_duration_hours") or 1.0
        priorita = prio_map.get((plan.get("priority") or "medium").lower(), "Media")
        
        for task_desc in plan.get("tasks", []):
            if not task_desc: continue
            
            # Crea direttamente il ticket
            ticket = Ticket(
                titolo=task_desc[:150],
                descrizione=task_desc,
                priorita=priorita,
                tipo="PM",
                stato="Aperto",
                durata_stimata_ore=durata,
                fascia_oraria="diurna",
                asset_id=piano.asset_id,
                tenant_id=tenant_id,
                piano_manutenzione_id=piano.id,
                origine_piano="manuale"
            )
            db.add(ticket)
            created_count += 1
    
    db.commit()
    return {"success": True, "created": created_count, "method": result.get("method")}


@router.post("/piani-manutenzione/{piano_id}/import-excel")
async def import_excel_to_piano(
    piano_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id)
):
    """Importa attività da Excel/CSV e le aggiunge come ticket al piano."""
    piano = db.query(PianoManutenzione).filter(
        PianoManutenzione.id == piano_id,
        PianoManutenzione.tenant_id == tenant_id
    ).first()
    if not piano:
        raise HTTPException(status_code=404, detail="Piano non trovato")

    content = await file.read()
    filename = file.filename.lower()
    
    rows = []
    if filename.endswith(".csv"):
        stream = io.StringIO(content.decode("utf-8", errors="ignore"))
        reader = csv.DictReader(stream, delimiter=";")
        rows = list(reader)
    else:
        # XLSX support via openpyxl
        try:
            from openpyxl import load_workbook
            wb = load_workbook(io.BytesIO(content), data_only=True)
            ws = wb.active
            header = [str(cell.value).strip().lower() if cell.value else "" for cell in ws[1]]
            for i in range(2, ws.max_row + 1):
                row_data = {}
                for col_idx, col_name in enumerate(header):
                    if col_name:
                        row_data[col_name] = ws.cell(row=i, column=col_idx+1).value
                if any(row_data.values()):
                    rows.append(row_data)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Errore lettura Excel: {str(e)}")

    created_count = 0
    for r in rows:
        # Mapping flessibile
        titolo = r.get("titolo") or r.get("attività") or r.get("descrizione")
        if not titolo: continue
        
        durata = r.get("durata") or r.get("ore") or 1.0
        priorita = r.get("priorità") or r.get("priorita") or "Media"
        
        ticket = Ticket(
            titolo=str(titolo)[:150],
            descrizione=str(titolo),
            priorita=str(priorita).capitalize() if priorita else "Media",
            tipo="PM",
            stato="Aperto",
            durata_stimata_ore=float(durata) if durata else 1.0,
            fascia_oraria="diurna",
            asset_id=piano.asset_id,
            tenant_id=tenant_id,
            piano_manutenzione_id=piano.id,
            origine_piano="excel"
        )
        db.add(ticket)
        created_count += 1
        
    db.commit()
    return {"success": True, "created": created_count}
