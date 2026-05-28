"""
Gestione documenti allegati agli asset.
Supporto speciale per "Esploso": analisi GPT-4o vision con overlay interattivo.
"""
from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.core.logger_db import db_info, db_error
from backend.db.modelli import Asset, AssetDocumento

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_DOC_BYTES = 30 * 1024 * 1024  # 30 MB
ALLOWED_TIPI = {"Esploso", "Manuale", "Schema elettrico", "Datasheet", "Certificato", "Altro"}
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}

ESPLOSO_PROMPT = """Sei un esperto di documentazione tecnica industriale. Analizza questo esploso tecnico e identifica tutte le parti/componenti visibili.

Per ogni parte restituisci un JSON array con oggetti:
{
  "numero": 1,
  "nome": "Nome parte",
  "descrizione": "Breve descrizione funzione",
  "colore": "#hex",
  "posizione_x": 0.5,
  "posizione_y": 0.3,
  "categoria": "struttura|meccanica|elettrica|idraulica|altro"
}

Restituisci SOLO il JSON array, nessun testo aggiuntivo."""


def _get_asset_or_404(db: Session, asset_id: int, tenant_id: int) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.tenant_id == tenant_id).first()
    if not asset:
        raise HTTPException(status_code=404, detail="Asset non trovato")
    return asset


def _get_doc_or_404(db: Session, asset_id: int, doc_id: int, tenant_id: int) -> AssetDocumento:
    doc = db.query(AssetDocumento).filter(
        AssetDocumento.id == doc_id,
        AssetDocumento.asset_id == asset_id,
        AssetDocumento.tenant_id == tenant_id,
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="Documento non trovato")
    return doc


@router.get("/assets/{asset_id}/documenti")
def lista_documenti(
    asset_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    _get_asset_or_404(db, asset_id, tenant_id)
    docs = (
        db.query(AssetDocumento)
        .filter(AssetDocumento.asset_id == asset_id, AssetDocumento.tenant_id == tenant_id)
        .order_by(AssetDocumento.created_at.desc())
        .all()
    )
    return [
        {
            "id": d.id,
            "nome": d.nome,
            "tipo": d.tipo,
            "filename": d.filename,
            "content_type": d.content_type,
            "ha_analisi": d.esploso_analisi is not None,
            "ha_immagine_ai": d.esploso_immagine is not None,
            "esploso_analisi": json.loads(d.esploso_analisi) if d.esploso_analisi else None,
            "created_at": d.created_at.isoformat() if d.created_at else None,
        }
        for d in docs
    ]


@router.post("/assets/{asset_id}/documenti", status_code=201)
async def upload_documento(
    asset_id: int,
    nome: str = Form(...),
    tipo: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    _get_asset_or_404(db, asset_id, tenant_id)

    if tipo not in ALLOWED_TIPI:
        raise HTTPException(
            status_code=400,
            detail=f"Tipo non valido: '{tipo}'. Ammessi: {', '.join(sorted(ALLOWED_TIPI))}",
        )

    import os
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Estensione non ammessa: '{ext}'. Ammesse: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    content = await file.read()
    if len(content) > MAX_DOC_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File troppo grande: massimo {MAX_DOC_BYTES // (1024 * 1024)} MB.",
        )

    doc = AssetDocumento(
        tenant_id=tenant_id,
        asset_id=asset_id,
        nome=nome,
        tipo=tipo,
        filename=file.filename or f"documento{ext}",
        content_type=file.content_type,
        file_data=content,
        created_at=datetime.now(timezone.utc),
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    db_info("asset_documenti", f"Documento '{nome}' caricato per asset {asset_id}", {"doc_id": doc.id, "tipo": tipo}, tenant_id=tenant_id)

    return {
        "id": doc.id,
        "nome": doc.nome,
        "tipo": doc.tipo,
        "filename": doc.filename,
        "content_type": doc.content_type,
        "ha_analisi": False,
        "esploso_analisi": None,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }


@router.get("/assets/{asset_id}/documenti/{doc_id}/file")
def scarica_documento(
    asset_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    doc = _get_doc_or_404(db, asset_id, doc_id, tenant_id)
    ct = doc.content_type or "application/octet-stream"
    headers = {"Content-Disposition": f'inline; filename="{doc.filename}"'}
    return Response(content=doc.file_data, media_type=ct, headers=headers)


@router.delete("/assets/{asset_id}/documenti/{doc_id}", status_code=204)
def elimina_documento(
    asset_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    doc = _get_doc_or_404(db, asset_id, doc_id, tenant_id)
    db_info("asset_documenti", f"Documento '{doc.nome}' eliminato per asset {asset_id}", {"doc_id": doc_id}, tenant_id=tenant_id)
    db.delete(doc)
    db.commit()
    return None


@router.post("/assets/{asset_id}/documenti/{doc_id}/analizza-esploso")
async def analizza_esploso(
    asset_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    from backend.core.config import OPENAI_API_KEY

    doc = _get_doc_or_404(db, asset_id, doc_id, tenant_id)

    if doc.tipo != "Esploso":
        raise HTTPException(status_code=422, detail="L'analisi esploso è disponibile solo per documenti di tipo 'Esploso'.")

    import os
    ext = os.path.splitext(doc.filename)[1].lower()
    if ext == ".pdf":
        raise HTTPException(
            status_code=422,
            detail="L'analisi visiva non supporta PDF. Carica l'esploso come immagine (PNG/JPG).",
        )

    if not OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OpenAI API key non configurata.")

    # Converti in base64
    image_b64 = base64.b64encode(doc.file_data).decode("utf-8")
    ct = doc.content_type or "image/jpeg"
    data_url = f"data:{ct};base64,{image_b64}"

    try:
        import openai
        client = openai.OpenAI(api_key=OPENAI_API_KEY, timeout=60.0)
        response = client.chat.completions.create(
            model="gpt-4o",  # usa gpt-4o per vision
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": ESPLOSO_PROMPT},
                        {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
                    ],
                }
            ],
            max_tokens=4096,
            temperature=0.2,
        )
    except Exception as exc:
        db_error("asset_documenti", f"Errore OpenAI analisi esploso doc {doc_id}: {exc}", tenant_id=tenant_id)
        raise HTTPException(status_code=503, detail=f"Errore durante l'analisi AI: {str(exc)}")

    raw = response.choices[0].message.content or ""
    # Pulisci eventuale markdown wrapping
    raw = raw.strip()
    if raw.startswith("```"):
        lines = raw.splitlines()
        raw = "\n".join(lines[1:-1]) if len(lines) > 2 else raw

    try:
        parti = json.loads(raw)
        if not isinstance(parti, list):
            raise ValueError("Risposta non è un array JSON")
    except (json.JSONDecodeError, ValueError) as exc:
        db_error("asset_documenti", f"Parse JSON analisi esploso fallito: {exc}", extra={"raw": raw[:500]}, tenant_id=tenant_id)
        raise HTTPException(status_code=422, detail=f"La risposta AI non è un JSON valido: {str(exc)}")

    doc.esploso_analisi = json.dumps(parti, ensure_ascii=False)
    db.commit()

    db_info("asset_documenti", f"Analisi esploso completata per doc {doc_id}: {len(parti)} parti identificate", tenant_id=tenant_id)

    return {"parti": parti, "n_parti": len(parti)}


@router.post("/assets/{asset_id}/documenti/{doc_id}/genera-infografica")
async def genera_infografica(
    asset_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Genera un'infografica AI colorata dall'esploso usando gpt-image-1 (Images API edit)."""
    from backend.core.config import OPENAI_API_KEY

    doc = _get_doc_or_404(db, asset_id, doc_id, tenant_id)

    if doc.tipo != "Esploso":
        raise HTTPException(status_code=422, detail="La generazione infografica è disponibile solo per documenti di tipo 'Esploso'.")

    import os
    ext = os.path.splitext(doc.filename)[1].lower()
    if ext == ".pdf":
        raise HTTPException(
            status_code=422,
            detail="La generazione infografica non supporta PDF. Carica l'esploso come immagine (PNG/JPG).",
        )

    if not OPENAI_API_KEY:
        raise HTTPException(status_code=503, detail="OpenAI API key non configurata.")

    # 1. Genera analisi esploso se non esiste ancora
    parti = []
    if not doc.esploso_analisi:
        image_b64 = base64.b64encode(doc.file_data).decode("utf-8")
        ct = doc.content_type or "image/jpeg"
        data_url = f"data:{ct};base64,{image_b64}"
        try:
            import openai as _openai
            vision_client = _openai.OpenAI(api_key=OPENAI_API_KEY, timeout=60.0)
            vision_resp = vision_client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": ESPLOSO_PROMPT},
                            {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
                        ],
                    }
                ],
                max_tokens=4096,
                temperature=0.2,
            )
            raw = (vision_resp.choices[0].message.content or "").strip()
            if raw.startswith("```"):
                lines = raw.splitlines()
                raw = "\n".join(lines[1:-1]) if len(lines) > 2 else raw
            try:
                parti = json.loads(raw)
                if isinstance(parti, list):
                    doc.esploso_analisi = json.dumps(parti, ensure_ascii=False)
            except (json.JSONDecodeError, ValueError):
                pass
        except Exception as exc:
            db_error("asset_documenti", f"Errore analisi vision pre-infografica doc {doc_id}: {exc}", tenant_id=tenant_id)
    else:
        try:
            parti = json.loads(doc.esploso_analisi)
        except (json.JSONDecodeError, ValueError):
            parti = []

    # 2. Chiama gpt-image-1 per generare l'infografica colorata
    import io
    import openai as _openai2

    INFOGRAFICA_PROMPT = (
        "Transform this technical exploded view drawing into a professional industrial infographic. "
        "Keep the same exploded view layout and all component positions identical. "
        "Apply vivid distinct colors to each numbered part/component group (use blues, greens, reds, oranges, purples, teals). "
        "Make the background white/light gray. "
        "Keep all existing part numbers visible and legible. "
        "Add a clean, modern technical illustration style. "
        "Make it look like a high-quality professional maintenance manual infographic."
    )

    try:
        img_client = _openai2.OpenAI(api_key=OPENAI_API_KEY, timeout=120.0)
        image_bytes_io = io.BytesIO(doc.file_data)
        image_bytes_io.name = doc.filename

        response = img_client.images.edit(
            model="gpt-image-1",
            image=image_bytes_io,
            prompt=INFOGRAFICA_PROMPT,
            size="1024x1024",
            n=1,
        )
    except Exception as exc:
        db_error("asset_documenti", f"Errore gpt-image-1 genera-infografica doc {doc_id}: {exc}", tenant_id=tenant_id)
        raise HTTPException(status_code=503, detail=f"Errore durante la generazione AI: {str(exc)}")

    # gpt-image-1 restituisce b64_json
    import base64 as _base64
    b64_data = response.data[0].b64_json
    if not b64_data:
        raise HTTPException(status_code=503, detail="La risposta AI non contiene dati immagine.")

    png_bytes = _base64.b64decode(b64_data)
    doc.esploso_immagine = png_bytes
    db.commit()

    db_info(
        "asset_documenti",
        f"Infografica AI generata per doc {doc_id} ({len(png_bytes)} bytes, {len(parti)} parti)",
        tenant_id=tenant_id,
    )

    return {"ok": True, "n_parti": len(parti)}


@router.get("/assets/{asset_id}/documenti/{doc_id}/immagine-ai")
def scarica_immagine_ai(
    asset_id: int,
    doc_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Restituisce l'immagine PNG generata da AI per un documento Esploso."""
    doc = _get_doc_or_404(db, asset_id, doc_id, tenant_id)
    if not doc.esploso_immagine:
        raise HTTPException(status_code=404, detail="Nessuna immagine AI generata per questo documento.")
    return Response(content=doc.esploso_immagine, media_type="image/png")
