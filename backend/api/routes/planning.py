"""
Router Planning — endpoint per la generazione e conferma dei piani manutenzione AI.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id
from backend.core.logging_config import get_logger
from backend.db.modelli import GeneratedPlan, Ticket, Asset
from backend.services.ai_planner_service import generate_ai_plan

router = APIRouter(prefix="/planning", tags=["planning"])
logger = get_logger(__name__)


# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class GeneratePlanRequest(BaseModel):
    days: int = 7
    asset_ids: Optional[List[int]] = None


class PlanResponse(BaseModel):
    id: int
    created_at: str
    status: str
    horizon_days: int
    plan_json: dict
    confirmed_at: Optional[str] = None

    class Config:
        from_attributes = True


def _plan_to_dict(plan: GeneratedPlan) -> dict:
    return {
        "id": plan.id,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
        "status": plan.status,
        "horizon_days": plan.horizon_days,
        "plan_json": plan.plan_json or {},
        "confirmed_at": plan.confirmed_at.isoformat() if plan.confirmed_at else None,
        "tenant_id": plan.tenant_id,
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_plan(
    data: GeneratePlanRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Genera un nuovo piano manutenzione AI per l'orizzonte specificato.
    Salva il piano come draft e lo ritorna.
    """
    logger.info("AI Planning: avvio generazione piano — days=%s tenant=%s", data.days, tenant_id)

    plan_json = await generate_ai_plan(
        db=db,
        days=data.days,
        asset_ids=data.asset_ids,
        tenant_id=tenant_id,
    )

    if "error" in plan_json:
        logger.error("AI Planning: errore generazione — %s", plan_json.get("error"))
        raise HTTPException(
            status_code=500,
            detail=f"Errore nella generazione del piano AI: {plan_json['error']}",
        )

    # Salva il piano come draft
    new_plan = GeneratedPlan(
        status="draft",
        horizon_days=data.days,
        plan_json=plan_json,
        tenant_id=tenant_id,
    )
    db.add(new_plan)
    db.commit()
    db.refresh(new_plan)

    logger.info(
        "AI Planning: piano generato — id=%s WO pianificati=%s WO rimandati=%s",
        new_plan.id,
        len(plan_json.get("planned_workorders", [])),
        len(plan_json.get("deferred_workorders", [])),
    )

    return _plan_to_dict(new_plan)


@router.post("/confirm/{plan_id}")
def confirm_plan(
    plan_id: int,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """
    Conferma un piano draft:
    - Aggiorna tecnico_id e planned_start sui ticket pianificati
    - Mette gli asset con fermo_on_schedule in stato 'Fermo'
    - Segna il piano come 'confirmed'
    """
    plan = db.query(GeneratedPlan).filter(
        GeneratedPlan.id == plan_id,
        GeneratedPlan.tenant_id == tenant_id,
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail=f"Piano {plan_id} non trovato")

    if plan.status == "confirmed":
        raise HTTPException(status_code=400, detail="Il piano è già stato confermato")

    plan_data = plan.plan_json or {}

    # Aggiorna i ticket pianificati
    planned = plan_data.get("planned_workorders", [])
    for wo in planned:
        wo_id = wo.get("wo_id")
        tecnico_id = wo.get("technician_id")
        planned_date_str = wo.get("planned_date")
        time_slot = wo.get("time_slot", "")

        if not wo_id:
            continue

        ticket = db.query(Ticket).filter(
            Ticket.id == wo_id,
            Ticket.tenant_id == tenant_id,
        ).first()

        if not ticket:
            logger.warning("Confirm plan: ticket %s non trovato", wo_id)
            continue

        ticket.tecnico_id = tecnico_id
        ticket.stato = "Pianificato"

        # Calcola planned_start e planned_finish dai campi calcolati da calculate_split_assignments
        if planned_date_str:
            try:
                start_time = wo.get("planned_start_time") or "08:00"
                end_time = wo.get("planned_end_time") or "17:00"
                if not start_time and time_slot and "-" in time_slot:
                    start_time = time_slot.split("-")[0].strip()
                    end_time = time_slot.split("-")[1].strip()
                planned_start = datetime.fromisoformat(f"{planned_date_str}T{start_time}:00")
                planned_finish = datetime.fromisoformat(f"{planned_date_str}T{end_time}:00")
                ticket.planned_start = planned_start
                ticket.planned_finish = planned_finish
            except ValueError:
                logger.warning("Confirm plan: impossibile parsare data/ora per ticket %s", wo_id)

    # Aggiorna asset con fermo_on_schedule
    fermo_assets = plan_data.get("fermo_assets", [])
    for fa in fermo_assets:
        asset_id = fa.get("asset_id")
        if not asset_id:
            continue
        asset = db.query(Asset).filter(
            Asset.id == asset_id,
            Asset.tenant_id == tenant_id,
        ).first()
        if asset:
            asset.stato = "Fermo"
            logger.info("Asset %s impostato in stato Fermo", asset_id)

    # Segna piano come confermato
    plan.status = "confirmed"
    plan.confirmed_at = datetime.utcnow()

    db.commit()
    db.refresh(plan)

    logger.info("AI Planning: piano %s confermato", plan_id)
    return _plan_to_dict(plan)


@router.get("/current")
def get_current_plan(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Ritorna l'ultimo piano in stato draft."""
    plan = (
        db.query(GeneratedPlan)
        .filter(GeneratedPlan.status == "draft", GeneratedPlan.tenant_id == tenant_id)
        .order_by(GeneratedPlan.created_at.desc())
        .first()
    )
    if not plan:
        return None
    return _plan_to_dict(plan)


@router.get("/history")
def get_plan_history(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Ritorna i piani confermati (max 20), ordinati per data decrescente."""
    plans = (
        db.query(GeneratedPlan)
        .filter(GeneratedPlan.status == "confirmed", GeneratedPlan.tenant_id == tenant_id)
        .order_by(GeneratedPlan.created_at.desc())
        .limit(20)
        .all()
    )
    return [_plan_to_dict(p) for p in plans]
