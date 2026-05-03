from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.core.exceptions import AppError
from backend.db.modelli import Ticket, Asset, FailureMode, DiagnosticLearning, FailureAnalysis
from backend.services.failure_engine import analyze_failure, confirm_failure_mode, classify_rpn

router = APIRouter(prefix="/failure", tags=["failure-engine"])


class AnalyzeRequest(BaseModel):
    symptoms: str
    description: str = ""
    asset_type: str = ""


class ConfirmRequest(BaseModel):
    failure_mode_id: int
    symptoms: str = ""
    real_cause: str
    action_taken: str
    resolution_time_minutes: int = 0
    success: bool = True


def _infer_asset_type(name: str) -> str:
    n = (name or "").lower()
    if any(k in n for k in ["pompa", "pump", "centrifug"]):
        return "pompa_centrifuga"
    if any(k in n for k in ["motore", "motor", "elettric"]):
        return "motore_elettrico"
    if any(k in n for k in ["compressor", "compress"]):
        return "compressore"
    if any(k in n for k in ["quadro", "panel", "mcc", "inverter", "vsd"]):
        return "quadro_elettrico"
    if any(k in n for k in ["valvol", "valve"]):
        return "valvola_industriale"
    if any(k in n for k in ["nastro", "conveyor", "trasport", "belt"]):
        return "nastro_trasportatore"
    return "generico"


@router.post("/tickets/{ticket_id}/analyze")
def analyze_ticket_failure(
    ticket_id: int,
    data: AnalyzeRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    ticket = db.query(Ticket).filter(
        Ticket.id == ticket_id, Ticket.tenant_id == tenant_id
    ).first()
    if not ticket:
        raise AppError(status_code=404, message="Ticket non trovato")

    asset_type = data.asset_type
    asset_info = None
    if ticket.asset_id:
        asset = db.query(Asset).filter(Asset.id == ticket.asset_id).first()
        if asset:
            if not asset_type:
                asset_type = _infer_asset_type(asset.nome or asset.area or "")
            asset_info = {
                "nome": asset.nome,
                "marca": asset.marca,
                "modello": asset.modello,
                "anno_installazione": asset.anno_installazione,
                "note_tecniche": asset.note_tecniche,
            }
    if not asset_type:
        asset_type = "generico"

    result = analyze_failure(
        db=db,
        ticket_id=ticket_id,
        asset_type=asset_type,
        symptoms=data.symptoms,
        description=data.description or ticket.descrizione or "",
        tenant_id=tenant_id,
        asset_info=asset_info,
    )
    return result


@router.post("/tickets/{ticket_id}/confirm")
def confirm_ticket_failure(
    ticket_id: int,
    data: ConfirmRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    ticket = db.query(Ticket).filter(
        Ticket.id == ticket_id, Ticket.tenant_id == tenant_id
    ).first()
    if not ticket:
        raise AppError(status_code=404, message="Ticket non trovato")

    return confirm_failure_mode(
        db=db,
        ticket_id=ticket_id,
        failure_mode_id=data.failure_mode_id,
        symptoms=data.symptoms,
        real_cause=data.real_cause,
        action_taken=data.action_taken,
        resolution_time_minutes=data.resolution_time_minutes,
        success=data.success,
        tenant_id=tenant_id,
    )


@router.get("/failure-modes")
def list_failure_modes(
    asset_type: str = "",
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    q = db.query(FailureMode).filter(
        (FailureMode.is_global == True) | (FailureMode.tenant_id == tenant_id)
    )
    if asset_type:
        q = q.filter(FailureMode.asset_type == asset_type)
    modes = q.order_by(FailureMode.asset_type, FailureMode.rpn.desc()).all()
    return [
        {
            "id": m.id,
            "asset_type": m.asset_type,
            "component": m.component,
            "failure_mode": m.failure_mode,
            "rpn": m.rpn,
            "rpn_class": classify_rpn(m.rpn),
            "severity": m.severity,
            "occurrence": m.occurrence,
            "detectability": m.detectability,
            "peso_appreso": round(m.peso_appreso, 3),
            "source": m.source,
        }
        for m in modes
    ]


@router.get("/learning-history")
def get_learning_history(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    records = (
        db.query(DiagnosticLearning)
        .filter(DiagnosticLearning.tenant_id == tenant_id)
        .order_by(DiagnosticLearning.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": r.id,
            "ticket_id": r.ticket_id,
            "real_cause": r.real_cause,
            "action_taken": r.action_taken,
            "resolution_time_minutes": r.resolution_time_minutes,
            "success": r.success,
            "created_at": r.created_at.isoformat(),
        }
        for r in records
    ]
