from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from backend.core.dependencies import get_db
from backend.core.security import get_current_tenant_id, check_tenant_ownership, require_roles
from backend.db.modelli import Asset, AssetConditionReading, AttivitaManutenzione
from backend.services.condition_maintenance_service import (
    METRIC_RUNNING_HOURS,
    latest_running_hours_by_asset,
    task_due_summary,
)

router = APIRouter()


class RunningHoursCreate(BaseModel):
    value: float = Field(..., ge=0)
    recorded_at: Optional[datetime] = None
    note: Optional[str] = Field(default=None, max_length=500)


def _asset_identity(asset: Asset) -> dict:
    impianto = asset.impianto
    sito = impianto.sito if impianto else None
    return {
        "asset_id": asset.id,
        "asset_nome": asset.nome or "",
        "asset_codice": asset.codice,
        "impianto_nome": impianto.nome if impianto else "",
        "sito_nome": sito.nome if sito else "",
    }


@router.get("/conditions/running-hours/assets")
def list_running_hours_assets(
    query: Optional[str] = Query(None),
    limit: int = Query(500, ge=1, le=1000),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    assets_query = db.query(Asset).filter(Asset.tenant_id == tenant_id)
    if query:
        pattern = f"%{query}%"
        assets_query = assets_query.filter((Asset.nome.ilike(pattern)) | (Asset.codice.ilike(pattern)))
    assets = assets_query.order_by(Asset.nome.asc()).limit(limit).all()
    asset_ids = [asset.id for asset in assets]
    latest = latest_running_hours_by_asset(db, tenant_id, asset_ids)
    if not asset_ids:
        return {"items": [], "total": 0}

    tasks = (
        db.query(AttivitaManutenzione)
        .filter(
            AttivitaManutenzione.tenant_id == tenant_id,
            AttivitaManutenzione.asset_id.in_(asset_ids),
            AttivitaManutenzione.trigger_mode.in_(["condition", "calendar_or_condition"]),
            AttivitaManutenzione.condition_metric == METRIC_RUNNING_HOURS,
            or_(AttivitaManutenzione.task_stato.is_(None), AttivitaManutenzione.task_stato != "archived"),
        )
        .all()
    )
    task_map: dict[int, list[dict]] = {}
    for task in tasks:
        summary = task_due_summary(task, latest.get(task.asset_id))
        condition = summary["condition"]
        task_map.setdefault(task.asset_id, []).append({
            "task_id": task.id,
            "piano_id": task.piano_id,
            "nome": task.nome or task.descrizione or f"Task #{task.id}",
            "trigger_mode": summary["trigger_mode"],
            "threshold_hours": condition["threshold_hours"],
            "due_at_hours": condition["due_at_hours"],
            "remaining_hours": condition["remaining_hours"],
            "is_due": condition["is_due"],
            "priorita": task.priorita or "Media",
        })

    items = []
    for asset in assets:
        reading = latest.get(asset.id)
        related_tasks = sorted(task_map.get(asset.id, []), key=lambda t: t["remaining_hours"] if t["remaining_hours"] is not None else 10**12)
        items.append({
            **_asset_identity(asset),
            "current_hours": reading.value if reading else None,
            "recorded_at": reading.recorded_at.isoformat() if reading else None,
            "due_tasks": [task for task in related_tasks if task["is_due"]],
            "condition_tasks": related_tasks,
        })

    return {"items": items, "total": len(items)}


@router.post("/conditions/running-hours/assets/{asset_id}", status_code=201)
def create_running_hours_reading(
    asset_id: int,
    data: RunningHoursCreate,
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
    _: dict = Depends(require_roles("responsabile")),
):
    check_tenant_ownership(db, Asset, asset_id, tenant_id)
    latest = latest_running_hours_by_asset(db, tenant_id, [asset_id]).get(asset_id)
    if latest and data.value < latest.value:
        raise HTTPException(status_code=422, detail="La nuova lettura ore non puo essere inferiore all'ultima lettura registrata.")

    recorded_at = data.recorded_at or datetime.now(timezone.utc)
    if recorded_at.tzinfo is None:
        recorded_at = recorded_at.replace(tzinfo=timezone.utc)

    reading = AssetConditionReading(
        asset_id=asset_id,
        tenant_id=tenant_id,
        metric=METRIC_RUNNING_HOURS,
        value=data.value,
        recorded_at=recorded_at,
        note=data.note,
    )
    db.add(reading)
    db.commit()
    db.refresh(reading)

    return {
        "id": reading.id,
        "asset_id": reading.asset_id,
        "metric": reading.metric,
        "value": reading.value,
        "recorded_at": reading.recorded_at.isoformat(),
        "note": reading.note,
    }


@router.get("/conditions/running-hours/assets/{asset_id}/readings")
def list_running_hours_readings(
    asset_id: int,
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    tenant_id: int = Depends(get_current_tenant_id),
):
    check_tenant_ownership(db, Asset, asset_id, tenant_id)
    readings = (
        db.query(AssetConditionReading)
        .filter(
            AssetConditionReading.asset_id == asset_id,
            AssetConditionReading.tenant_id == tenant_id,
            AssetConditionReading.metric == METRIC_RUNNING_HOURS,
        )
        .order_by(AssetConditionReading.recorded_at.desc(), AssetConditionReading.id.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": r.id,
            "asset_id": r.asset_id,
            "metric": r.metric,
            "value": r.value,
            "recorded_at": r.recorded_at.isoformat(),
            "note": r.note,
        }
        for r in readings
    ]
