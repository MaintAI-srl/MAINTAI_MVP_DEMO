import json

from fastapi import APIRouter, UploadFile, File, Form, Depends
from pydantic import BaseModel as PydanticModel
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.exceptions import AppError
from backend.core.logging_config import get_logger
from backend.db.modelli import Manuale, AttivitaManutenzione, Asset
from backend.services.pdf_service import smart_read_pdf
from backend.services.ai.manuals_ai_service import salva_manuale_db, parse_manual_with_ai

router = APIRouter()
logger = get_logger(__name__)


@router.post("/manuali/upload")
async def upload_manuale(
    file: UploadFile = File(...),
    asset_id: int | None = Form(None),
    new_asset_name: str | None = Form(None),
    
    new_asset_area: str | None = Form(None),
    db: Session = Depends(get_db),
):
    """
    Flusso completo: PDF → testo → AI parsing → Manuale + AttivitaManutenzione nel DB.
    asset_id: ID asset esistente selezionato dal frontend.
    new_asset_name: se fornito, crea un nuovo asset prima del parsing.
    """
    # 1. Risolvi asset: crea nuovo se richiesto, altrimenti usa ID fornito
    resolved_asset_id: int | None = asset_id

    if new_asset_name and new_asset_name.strip():
        nuovo = Asset(
            nome=new_asset_name.strip(),
            
            area=new_asset_area or "",
            vincolo_orario="",
            note="",
        )
        db.add(nuovo)
        db.commit()
        db.refresh(nuovo)
        resolved_asset_id = nuovo.id
        logger.info(f"Nuovo asset creato automaticamente: id={nuovo.id} nome='{nuovo.nome}'")

    content = await file.read()
    result = smart_read_pdf(content)
    text = result.get("text", "")

    if not text.strip():
        raise AppError(
            status_code=422,
            message="Nessun testo estratto dal PDF. Il file potrebbe essere scansionato o protetto.",
        )

    logger.info(f"Upload manuale '{file.filename}' — {len(text)} caratteri estratti")

    parsed_json_str = parse_manual_with_ai(text, file.filename)

    manuale = salva_manuale_db(
        db=db,
        nome_file=file.filename,
        pagine=result.get("pages", 0),
        metodo_lettura=result.get("method", ""),
        testo_raw=text,
        json_estratto=parsed_json_str,
    )

    logger.debug("AI raw response (%d chars): %s", len(parsed_json_str), parsed_json_str[:500])

    try:
        parsed = json.loads(parsed_json_str)
    except Exception as exc:
        logger.error(f"JSON parsing fallito per manuale {manuale.id}: {exc}")
        logger.error(f"Raw AI output: {parsed_json_str[:2000]}")
        return {
            "id_manuale": manuale.id,
            "filename": file.filename,
            "pages": result.get("pages", 0),
            "task_count": 0,
            "tasks": [],
            "warning": f"AI ha risposto ma il JSON non è valido: {exc}",
        }

    # Supporta sia il nuovo schema {plans, diagnostics} che il vecchio {tasks}
    plans = parsed.get("plans", [])
    logger.info("Piani trovati: %d, diagnostics: %d", len(plans), len(parsed.get("diagnostics", [])))
    for i, p in enumerate(plans):
        logger.debug("Piano[%d] title=%s tasks=%d freq=%s", i, p.get("title"), len(p.get("tasks", [])), p.get("frequency"))
    asset_name_ai = parsed.get("asset", "") or parsed.get("asset_name", "")
    categoria_ai = ""

    _priority_map = {"high": "Alta", "medium": "Media", "low": "Bassa",
                     "alta": "Alta", "media": "Media", "bassa": "Bassa"}

    def _freq_days(freq: dict) -> int | None:
        """Converte l'oggetto frequency del nuovo schema in giorni interi."""
        if not freq:
            return None
        value = freq.get("value")
        if value is None:
            return None
        unit = (freq.get("unit") or "days").lower()
        multipliers = {"days": 1, "weeks": 7, "months": 30, "years": 365}
        return int(value * multipliers.get(unit, 1))

    # Se nessun asset fornito dal frontend, tenta match AI
    if resolved_asset_id is None:
        asset = None
        
        if not asset and asset_name_ai:
            asset = db.query(Asset).filter(Asset.nome.ilike(f"%{asset_name_ai}%")).first()
        resolved_asset_id = asset.id if asset else None

    asset_id = resolved_asset_id

    saved_tasks = []
    seen_descriptions: set[str] = set()

    if plans:
        # Nuovo schema: appiattisce plans[].tasks in righe individuali
        for plan in plans:
            freq_days = _freq_days(plan.get("frequency", {}))
            durata = plan.get("estimated_duration_hours")
            priorita_raw = plan.get("priority", "medium")
            priorita = _priority_map.get(priorita_raw.lower(), "Media")
            for task_str in plan.get("tasks", []):
                descrizione = task_str.strip()
                if not descrizione:
                    continue
                # Deduplicazione: salta task con descrizione già vista in questo upload
                key = descrizione.lower()
                if key in seen_descriptions:
                    logger.debug("Skip duplicato: %s", descrizione[:80])
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
                )
                db.add(att)
                saved_tasks.append({
                    "attivita": att.descrizione,
                    "frequenza_giorni": att.frequenza_giorni,
                    "durata_ore": att.durata_ore,
                    "priorita": att.priorita,
                })
    else:
        # Vecchio schema di fallback: lista piatta tasks[]
        for task in parsed.get("tasks", []):
            att = AttivitaManutenzione(
                asset_id=asset_id,
                manuale_id=manuale.id,
                descrizione=task.get("attivita") or "",
                frequenza_giorni=task.get("frequenza_giorni"),
                durata_ore=task.get("durata_ore"),
                priorita=_priority_map.get((task.get("priorita") or "media").lower(), "Media"),
                origine="manuale",
            )
            db.add(att)
            saved_tasks.append({
                "attivita": att.descrizione,
                "frequenza_giorni": att.frequenza_giorni,
                "durata_ore": att.durata_ore,
                "priorita": att.priorita,
            })

    db.commit()

    logger.info(
        f"Manuale {manuale.id} salvato — {len(saved_tasks)} attività create, asset_id={asset_id}"
    )

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
def list_manuali(db: Session = Depends(get_db)):
    manuali = db.query(Manuale).order_by(Manuale.id.desc()).all()
    return [
        {
            "id": m.id,
            "nome": m.nome_file,
            "pagine": m.pagine or 0,
            "metodo": m.metodo_lettura or "",
            "task_count": db.query(AttivitaManutenzione)
                .filter(AttivitaManutenzione.manuale_id == m.id)
                .count(),
            "version": m.version or 1,
            "stato": m.stato or "attivo",
        }
        for m in manuali
    ]


@router.patch("/manuali/{manuale_id}")
def patch_manuale(manuale_id: int, data: ManualePatch, db: Session = Depends(get_db)):
    manuale = db.query(Manuale).filter(Manuale.id == manuale_id).first()
    if not manuale:
        raise AppError(status_code=404, message=f"Manuale {manuale_id} non trovato")
    if data.stato is not None:
        manuale.stato = data.stato
    if data.version is not None:
        manuale.version = data.version
    db.commit()
    db.refresh(manuale)
    return {
        "id": manuale.id,
        "nome": manuale.nome_file,
        "version": manuale.version or 1,
        "stato": manuale.stato or "attivo",
    }


@router.get("/manuali/{manuale_id}/piano")
def get_piano_manuale(manuale_id: int, db: Session = Depends(get_db)):
    manuale = db.query(Manuale).filter(Manuale.id == manuale_id).first()
    if not manuale:
        raise AppError(status_code=404, message=f"Manuale {manuale_id} non trovato")

    attivita = (
        db.query(AttivitaManutenzione)
        .filter(AttivitaManutenzione.manuale_id == manuale_id)
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
