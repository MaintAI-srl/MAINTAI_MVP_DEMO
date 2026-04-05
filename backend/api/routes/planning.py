"""
Router Planning — generazione, conferma, deautorizzazione e storico piani manutenzione.
"""
from __future__ import annotations

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id, get_current_user_payload
from backend.core.logging_config import get_logger
from backend.db.modelli import GeneratedPlan, Ticket, Asset
from backend.services.ai_planner_service import generate_ai_plan
from backend.services.planner_engine_bridge import generate_deterministic_plan

router = APIRouter(prefix="/planning", tags=["planning"])
logger = get_logger(__name__)


# ── Pydantic Schemas ──────────────────────────────────────────────────────────

class GeneratePlanRequest(BaseModel):
    days: int = 7
    asset_ids: Optional[List[int]] = None
    mode: str = "auto"   # "deterministic" | "ai" | "auto"


class DeauthorizeRequest(BaseModel):
    reason: str


def _wo_count(plan: GeneratedPlan) -> int:
    """Conta i ticket pianificati (non le continuazioni)."""
    if not plan.plan_json:
        return 0
    wos = plan.plan_json.get("planned_workorders", [])
    return len([w for w in wos if not w.get("is_continuation", False)])


def _plan_to_dict(plan: GeneratedPlan) -> dict:
    """Serializza un GeneratedPlan includendo tutti i campi storico."""
    pn = plan.plan_number
    return {
        "id": plan.id,
        "plan_number": pn,
        "plan_label": f"PIANO-{pn:03d}" if pn else None,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
        "status": plan.status,
        "horizon_days": plan.horizon_days,
        "plan_json": plan.plan_json or {},
        "confirmed_at": plan.confirmed_at.isoformat() if plan.confirmed_at else None,
        "confirmed_by": plan.confirmed_by,
        "deauthorized_at": plan.deauthorized_at.isoformat() if plan.deauthorized_at else None,
        "deauthorized_by": plan.deauthorized_by,
        "deauthorization_reason": plan.deauthorization_reason,
        "wo_count": _wo_count(plan),
        "tenant_id": plan.tenant_id,
        "efficiency_score": (plan.plan_json or {}).get("efficiency_score"),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_plan(
    data: GeneratePlanRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Genera un piano AI e lo salva come draft."""
    import os
    has_openai = bool(os.getenv("OPENAI_API_KEY", "").strip())

    # Risolvi mode "auto": deterministico se no OpenAI key, AI altrimenti
    effective_mode = data.mode
    if effective_mode == "auto":
        effective_mode = "ai" if has_openai else "deterministic"

    logger.info(
        "Planning: avvio generazione — mode=%s days=%s tenant=%s",
        effective_mode, data.days, tenant_id,
    )

    if effective_mode == "deterministic":
        plan_json = await generate_deterministic_plan(
            db=db,
            days=data.days,
            asset_ids=data.asset_ids,
            tenant_id=tenant_id,
        )
    else:
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
        "Planning [%s]: piano generato — id=%s WO=%s rimandati=%s",
        effective_mode,
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
    payload: dict = Depends(get_current_user_payload),
):
    """
    Conferma un piano draft:
    - Assegna plan_number progressivo per tenant
    - Aggiorna tecnico_id, planned_start, planned_finish sui ticket pianificati
    - Imposta asset con fermo_on_schedule in stato 'Fermo'
    - Salva confirmed_by (username dal token)
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

    # Aggiorna i ticket pianificati (zero nuovi record)
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

        # Calcola planned_start e planned_finish dai campi orari
        if planned_date_str:
            try:
                start_time = wo.get("planned_start_time") or "08:00"
                end_time = wo.get("planned_end_time") or "17:00"
                if not start_time and time_slot and "-" in time_slot:
                    start_time = time_slot.split("-")[0].strip()
                    end_time = time_slot.split("-")[1].strip()
                ticket.planned_start = datetime.fromisoformat(f"{planned_date_str}T{start_time}:00")
                ticket.planned_finish = datetime.fromisoformat(f"{planned_date_str}T{end_time}:00")
            except ValueError:
                logger.warning("Confirm plan: impossibile parsare data/ora per ticket %s", wo_id)

    # Aggiorna asset con fermo_on_schedule
    for fa in plan_data.get("fermo_assets", []):
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

    # Assegna plan_number progressivo (MAX per tenant + 1, primo = 1)
    max_num = db.query(func.max(GeneratedPlan.plan_number)).filter(
        GeneratedPlan.tenant_id == tenant_id,
        GeneratedPlan.plan_number.isnot(None),
    ).scalar()
    plan.plan_number = (max_num or 0) + 1

    # Segna piano come confermato
    plan.status = "confirmed"
    plan.confirmed_at = datetime.utcnow()
    plan.confirmed_by = payload.get("sub", "sconosciuto")

    db.commit()
    db.refresh(plan)

    logger.info(
        "AI Planning: piano %s confermato da %s (PIANO-%03d)",
        plan_id, plan.confirmed_by, plan.plan_number,
    )
    return _plan_to_dict(plan)


@router.post("/deauthorize/{plan_id}")
def deauthorize_plan(
    plan_id: int,
    data: DeauthorizeRequest,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    payload: dict = Depends(get_current_user_payload),
):
    """
    Deautorizza un piano confermato.
    Flag amministrativo: NON modifica i ticket già pianificati.
    """
    plan = db.query(GeneratedPlan).filter(
        GeneratedPlan.id == plan_id,
        GeneratedPlan.tenant_id == tenant_id,
    ).first()

    if not plan:
        raise HTTPException(status_code=404, detail=f"Piano {plan_id} non trovato")

    if plan.status == "deauthorized":
        raise HTTPException(status_code=400, detail="Il piano è già stato deautorizzato")

    if plan.status != "confirmed":
        raise HTTPException(status_code=400, detail="Solo i piani confermati possono essere deautorizzati")

    plan.status = "deauthorized"
    plan.deauthorized_at = datetime.utcnow()
    plan.deauthorized_by = payload.get("sub", "sconosciuto")
    plan.deauthorization_reason = data.reason.strip()

    db.commit()
    db.refresh(plan)

    logger.info(
        "AI Planning: piano %s (PIANO-%03d) deautorizzato da %s — motivo: %s",
        plan_id, plan.plan_number or 0, plan.deauthorized_by, plan.deauthorization_reason[:50],
    )
    return _plan_to_dict(plan)


@router.get("/current")
def get_current_plan(
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    """Ritorna l'ultimo piano in stato draft per il tenant corrente."""
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
    """
    Ritorna i piani confermati e deautorizzati (max 50),
    ordinati per plan_number decrescente (più recente prima).
    """
    plans = (
        db.query(GeneratedPlan)
        .filter(
            GeneratedPlan.status.in_(["confirmed", "deauthorized"]),
            GeneratedPlan.tenant_id == tenant_id,
        )
        .order_by(
            GeneratedPlan.plan_number.desc().nullslast(),
            GeneratedPlan.confirmed_at.desc(),
        )
        .limit(50)
        .all()
    )
    return [_plan_to_dict(p) for p in plans]
