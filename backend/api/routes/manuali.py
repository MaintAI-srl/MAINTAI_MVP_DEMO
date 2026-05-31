import json

from fastapi import APIRouter, UploadFile, File, Form, Depends, Query
from pydantic import BaseModel as PydanticModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.core.exceptions import AppError
from backend.core.file_validation import is_pdf
from backend.core.logging_config import get_logger
from backend.db.modelli import Manuale, AttivitaManutenzione, Asset
from backend.services.pdf_service import smart_read_pdf
from backend.services.ai.manuals_ai_service import salva_manuale_db, parse_manual_with_ai
from backend.core.security import check_tenant_ownership

router = APIRouter()
logger = get_logger(__name__)
MAX_MANUALE_BYTES = 25 * 1024 * 1024  # 25 MB


@router.post("/manuali/upload")
async def upload_manuale(
    file: UploadFile = File(...),
    asset_id: int | None = Form(None),
    new_asset_name: str | None = Form(None),
    new_asset_area: str | None = Form(None),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    if new_asset_name and new_asset_name.strip():
        nuovo = Asset(
            nome=new_asset_name.strip(),
            area=new_asset_area or "",
            vincolo_orario="",
            note="",
            tenant_id=tenant_id,
        )
        db.add(nuovo)
        db.commit()
        db.refresh(nuovo)
        resolved_asset_id = nuovo.id
        logger.info("Nuovo asset creato automaticamente: id=%d nome='%s'", nuovo.id, nuovo.nome)
    else:
        resolved_asset_id = asset_id
        if resolved_asset_id:
            check_tenant_ownership(db, Asset, resolved_asset_id, tenant_id)

    content = await file.read()
    if not content:
        raise AppError(status_code=400, message="File vuoto.")
    if len(content) > MAX_MANUALE_BYTES:
        raise AppError(
            status_code=413,
            message=f"File troppo grande: massimo {MAX_MANUALE_BYTES // (1024 * 1024)} MB consentiti.",
        )
    if not is_pdf(file.filename, content):
        raise AppError(
            status_code=415,
            message="Sono ammessi solo file PDF validi (estensione .pdf e contenuto PDF).",
        )

    result = smart_read_pdf(content)
    text = result.get("text", "")

    if not text.strip():
        raise AppError(
            status_code=422,
            message="Nessun testo estratto dal PDF. Il file potrebbe essere scansionato o protetto.",
        )

    logger.info("Upload manuale '%s' — %d caratteri estratti", file.filename, len(text))

    parsed_json_str = parse_manual_with_ai(text, file.filename)

    manuale = salva_manuale_db(
        db=db,
        nome_file=file.filename,
        pagine=result.get("pages", 0),
        metodo_lettura=result.get("method", ""),
        testo_raw=text,
        json_estratto=parsed_json_str,
        tenant_id=tenant_id,
    )

    logger.debug("AI raw response (%d chars): %s", len(parsed_json_str), parsed_json_str[:500])

    try:
        parsed = json.loads(parsed_json_str)
    except Exception as exc:
        logger.error("JSON parsing fallito per manuale %d: %s", manuale.id, exc)
        return {
            "id_manuale": manuale.id,
            "filename": file.filename,
            "pages": result.get("pages", 0),
            "task_count": 0,
            "tasks": [],
            "warning": f"AI ha risposto ma il JSON non è valido: {exc}",
        }

    plans = parsed.get("plans", [])
    asset_name_ai = parsed.get("asset", "") or parsed.get("asset_name", "")

    _priority_map = {"high": "Alta", "medium": "Media", "low": "Bassa",
                     "alta": "Alta", "media": "Media", "bassa": "Bassa"}

    def _freq_days(freq: dict) -> int | None:
        if not freq:
            return None
        value = freq.get("value")
        if value is None:
            return None
        unit = (freq.get("unit") or "days").lower()
        multipliers = {"days": 1, "weeks": 7, "months": 30, "years": 365}
        return int(value * multipliers.get(unit, 1))

    if resolved_asset_id is None and asset_name_ai:
        asset = db.query(Asset).filter(
            Asset.nome.ilike(f"%{asset_name_ai}%"),
            Asset.tenant_id == tenant_id,
        ).first()
        resolved_asset_id = asset.id if asset else None

    asset_id = resolved_asset_id
    saved_tasks = []
    seen_descriptions: set[str] = set()

    if plans:
        for plan in plans:
            freq_days = _freq_days(plan.get("frequency", {}))
            durata = plan.get("estimated_duration_hours")
            priorita_raw = plan.get("priority", "medium")
            priorita = _priority_map.get(priorita_raw.lower(), "Media")
            for task_str in plan.get("tasks", []):
                descrizione = task_str.strip()
                if not descrizione:
                    continue
                key = descrizione.lower()
                if key in seen_descriptions:
                    continue
                seen_descriptions.add(key)
                att = AttivitaManutenzione(
                    asset_id=asset_id,
                    manuale_id=manuale.id,
                    descrizione=descrizione,
                    frequenza_giorni=freq_days,
                    durata_ore=durata,
                    priorita=priorita,
                    origine="manuale",
                    tenant_id=tenant_id,
                )
                db.add(att)
                saved_tasks.append({
                    "attivita": att.descrizione,
                    "frequenza_giorni": att.frequenza_giorni,
                    "durata_ore": att.durata_ore,
                    "priorita": att.priorita,
                })
    else:
        for task in parsed.get("tasks", []):
            att = AttivitaManutenzione(
                asset_id=asset_id,
                manuale_id=manuale.id,
                descrizione=task.get("attivita") or "",
                frequenza_giorni=task.get("frequenza_giorni"),
                durata_ore=task.get("durata_ore"),
                priorita=_priority_map.get((task.get("priorita") or "media").lower(), "Media"),
                origine="manuale",
                tenant_id=tenant_id,
            )
            db.add(att)
            saved_tasks.append({
                "attivita": att.descrizione,
                "frequenza_giorni": att.frequenza_giorni,
                "durata_ore": att.durata_ore,
                "priorita": att.priorita,
            })

    db.commit()
    logger.info("Manuale %d salvato — %d attività create, asset_id=%s", manuale.id, len(saved_tasks), asset_id)

    return {
        "id_manuale": manuale.id,
        "filename": file.filename,
        "pages": result.get("pages", 0),
        "asset_name": asset_name_ai,
        "asset_id": asset_id,
        "task_count": len(saved_tasks),
        "tasks": saved_tasks,
        "warning": result.get("warning", ""),
    }


class ManualePatch(PydanticModel):
    stato: str | None = None
    version: int | None = None


@router.get("/manuali")
def list_manuali(
    piano_id: int | None = Query(None),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id)
):
    query = db.query(Manuale).filter(Manuale.tenant_id == tenant_id)
    if piano_id is not None:
        query = query.filter(Manuale.piano_id == piano_id)
        
    manuali = query.order_by(Manuale.id.desc()).limit(200).all()
    ids = [m.id for m in manuali]
    counts: dict[int, int] = {}
    if ids:
        counts = dict(
            db.query(AttivitaManutenzione.manuale_id, func.count(AttivitaManutenzione.id))
            .filter(AttivitaManutenzione.manuale_id.in_(ids))
            .group_by(AttivitaManutenzione.manuale_id)
            .all()
        )
    return [
        {
            "id": m.id,
            "nome": m.nome_file,
            "pagine": m.pagine or 0,
            "metodo": m.metodo_lettura or "",
            "task_count": counts.get(m.id, 0),
            "version": m.version or 1,
            "stato": m.stato or "attivo",
        }
        for m in manuali
    ]


@router.patch("/manuali/{manuale_id}")
def patch_manuale(manuale_id: int, data: ManualePatch, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    manuale = db.query(Manuale).filter(Manuale.id == manuale_id, Manuale.tenant_id == tenant_id).first()
    if not manuale:
        raise AppError(status_code=404, message=f"Manuale {manuale_id} non trovato")
    if data.stato is not None:
        manuale.stato = data.stato
    if data.version is not None:
        manuale.version = data.version
    db.commit()
    db.refresh(manuale)
    return {"id": manuale.id, "nome": manuale.nome_file, "version": manuale.version or 1, "stato": manuale.stato or "attivo"}


class RicercaManualeRequest(PydanticModel):
    query: str


@router.post("/manuali/cerca")
def cerca_manuali(
    data: RicercaManualeRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Ricerca full-text sui manuali caricati: cerca la query nel nome file
    e nel testo grezzo estratto dal PDF (testo_raw).

    Base per futura integrazione RAG — al momento usa ILIKE SQL per
    un'esperienza keyword-search immediata senza infrastruttura vettoriale.
    Limite 20 risultati per risposta lean.
    """
    q = data.query.strip()
    if not q:
        raise AppError(status_code=400, message="Query non può essere vuota.")

    pattern = f"%{q}%"

    # Cerca nei nomi file + nel testo raw estratto dal PDF
    manuali = (
        db.query(Manuale)
        .filter(
            Manuale.tenant_id == tenant_id,
            (Manuale.nome_file.ilike(pattern)) | (Manuale.testo_raw.ilike(pattern)),
        )
        .order_by(Manuale.id.desc())
        .limit(20)
        .all()
    )

    results = []
    for m in manuali:
        # Estrai snippet del contesto attorno alla keyword nel testo_raw
        snippet = ""
        if m.testo_raw:
            testo_lower = m.testo_raw.lower()
            idx = testo_lower.find(q.lower())
            if idx >= 0:
                start = max(0, idx - 80)
                end = min(len(m.testo_raw), idx + 160)
                snippet = m.testo_raw[start:end].replace("\n", " ").strip()

        results.append({
            "id": m.id,
            "nome": m.nome_file,
            "pagine": m.pagine or 0,
            "snippet": snippet,
        })

    return {"query": q, "totale": len(results), "risultati": results}


@router.get("/manuali/{manuale_id}/piano")
def get_piano_manuale(manuale_id: int, db: Session = Depends(get_db), tenant_id: int = Depends(get_current_tenant_id)):
    manuale = db.query(Manuale).filter(Manuale.id == manuale_id, Manuale.tenant_id == tenant_id).first()
    if not manuale:
        raise AppError(status_code=404, message=f"Manuale {manuale_id} non trovato")

    attivita = (
        db.query(AttivitaManutenzione)
        .filter(
            AttivitaManutenzione.manuale_id == manuale_id,
            AttivitaManutenzione.tenant_id == tenant_id,
        )
        .order_by(AttivitaManutenzione.id)
        .all()
    )

    return {
        "id_manuale": manuale.id,
        "filename": manuale.nome_file,
        "pagine": manuale.pagine or 0,
        "attivita": [
            {
                "id": a.id,
                "descrizione": a.descrizione,
                "frequenza_giorni": a.frequenza_giorni,
                "durata_ore": a.durata_ore,
                "priorita": a.priorita,
                "asset_id": a.asset_id,
            }
            for a in attivita
        ],
    }
