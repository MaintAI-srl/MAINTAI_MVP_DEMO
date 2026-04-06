import math
from datetime import date, timedelta
from calendar import monthrange

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.db.modelli import TecnicoAssenza, Tecnico
from backend.repositories.tecnico_repository import tecnico_repository
from backend.schemas.schemas import TecnicoCreate, TecnicoUpdate, TecnicoAssenzaCreate, TecnicoAssenzaResponse

router = APIRouter()

STATI_VALIDI = {"in servizio", "ferie", "malattia", "corso"}


def _working_days_in_range(start: date, end: date) -> int:
    count = 0
    current = start
    while current <= end:
        if current.weekday() < 5:
            count += 1
        current += timedelta(days=1)
    return count


@router.get("/tecnici")
def get_tecnici(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    return tecnico_repository.get_all(db, tenant_id)


@router.get("/tecnici/disponibili")
def get_tecnici_disponibili(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    return tecnico_repository.get_disponibili(db, tenant_id)


@router.get("/tecnici/me")
def get_current_tecnico(db: Session = Depends(get_db), utente_id: int = Query(...), tenant_id: int = Depends(get_current_tenant_id)):
    from backend.db.modelli import Tecnico
    tecnico = db.query(Tecnico).filter(Tecnico.utente_id == utente_id, Tecnico.tenant_id == tenant_id).first()
    if not tecnico:
        raise HTTPException(status_code=404, detail="Profilo tecnico non trovato per questo utente")
    return tecnico_repository._to_dict(tecnico)


@router.get("/tecnici/statistiche")
def tecnici_statistiche(db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    today = date.today()
    attivi = tecnico_repository.get_disponibili(db, tenant_id)
    ore_giornaliere_totali = sum(t["ore_giornaliere"] for t in attivi)

    daily = ore_giornaliere_totali if today.weekday() < 5 else 0

    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=4)
    wd_week = _working_days_in_range(max(today, week_start), week_end)
    weekly = ore_giornaliere_totali * wd_week

    last_day = date(today.year, today.month, monthrange(today.year, today.month)[1])
    wd_month = _working_days_in_range(today, last_day)
    monthly = ore_giornaliere_totali * wd_month

    year_end = date(today.year, 12, 31)
    wd_year = _working_days_in_range(today, year_end)
    annual = ore_giornaliere_totali * wd_year

    per_tecnico = [
        {
            "nome": f"{t['nome']} {t.get('cognome', '')}".strip(),
            "ore_giornaliere": t["ore_giornaliere"],
            "stato": t["stato"],
        }
        for t in attivi
    ]

    return {
        "tecnici_attivi": len(attivi),
        "ore_giornaliere_totali": ore_giornaliere_totali,
        "oggi": {"ore": daily, "giorno": today.strftime("%A %d/%m/%Y")},
        "settimana": {"ore": weekly, "dal": week_start.isoformat(), "al": week_end.isoformat()},
        "mese": {"ore": monthly, "mese": today.strftime("%B %Y")},
        "anno": {"ore": annual, "anno": today.year},
        "per_tecnico": per_tecnico,
    }


@router.post("/tecnici", status_code=201)
def create_tecnico(tecnico: TecnicoCreate, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    if not tecnico.nome.strip():
        raise HTTPException(status_code=422, detail="Il campo 'nome' è obbligatorio")
    if tecnico.stato and tecnico.stato not in STATI_VALIDI:
        raise HTTPException(status_code=422, detail=f"Stato non valido. Valori ammessi: {', '.join(STATI_VALIDI)}")
    return tecnico_repository.create(db, tecnico, tenant_id)


@router.put("/tecnici/{tecnico_id}")
def update_tecnico(tecnico_id: int, data: TecnicoUpdate, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    if data.stato and data.stato not in STATI_VALIDI:
        raise HTTPException(status_code=422, detail=f"Stato non valido. Valori ammessi: {', '.join(STATI_VALIDI)}")
    updated = tecnico_repository.update(db, tecnico_id, data, tenant_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Tecnico non trovato")
    return updated


@router.delete("/tecnici/{tecnico_id}", status_code=204)
def delete_tecnico(tecnico_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    ok = tecnico_repository.delete(db, tecnico_id, tenant_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Tecnico non trovato")


# ── Assenze Tecnici ────────────────────────────────────────────────────────

@router.get("/tecnici/{tecnico_id}/assenze", response_model=list[TecnicoAssenzaResponse])
def get_assenze_tecnico(tecnico_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    # Verifica che il tecnico appartenga al tenant
    t = db.query(Tecnico).filter(Tecnico.id == tecnico_id, Tecnico.tenant_id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tecnico non trovato")
    assenze = db.query(TecnicoAssenza).filter(TecnicoAssenza.tecnico_id == tecnico_id).limit(200).all()
    return assenze

@router.post("/tecnici/{tecnico_id}/assenze", response_model=TecnicoAssenzaResponse, status_code=201)
def create_assenza_tecnico(tecnico_id: int, assenza: TecnicoAssenzaCreate, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    t = db.query(Tecnico).filter(Tecnico.id == tecnico_id, Tecnico.tenant_id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tecnico non trovato")
    if assenza.data_fine < assenza.data_inizio:
        raise HTTPException(status_code=400, detail="Data fine deve essere dopo data inizio")
    nuova_assenza = TecnicoAssenza(
        tecnico_id=tecnico_id,
        data_inizio=assenza.data_inizio,
        data_fine=assenza.data_fine,
        tipo_assenza=assenza.tipo_assenza,
        note=assenza.note,
        tenant_id=tenant_id,
    )
    db.add(nuova_assenza)
    db.commit()
    db.refresh(nuova_assenza)
    return nuova_assenza

@router.delete("/tecnici/assenze/{assenza_id}", status_code=204)
def delete_assenza_tecnico(assenza_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    assenza = db.query(TecnicoAssenza).filter(TecnicoAssenza.id == assenza_id).first()
    if not assenza:
        raise HTTPException(status_code=404, detail="Assenza non trovata")
    # Verifica che il tecnico appartenga al tenant
    t = db.query(Tecnico).filter(Tecnico.id == assenza.tecnico_id, Tecnico.tenant_id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=403, detail="Accesso non autorizzato")
    db.delete(assenza)
    db.commit()
