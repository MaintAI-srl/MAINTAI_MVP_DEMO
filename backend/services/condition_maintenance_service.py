from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Iterable

from sqlalchemy.orm import Session

from backend.db.modelli import AssetConditionReading, AttivitaManutenzione


TRIGGER_CALENDAR = "calendar"
TRIGGER_CONDITION = "condition"
TRIGGER_CALENDAR_OR_CONDITION = "calendar_or_condition"
METRIC_RUNNING_HOURS = "running_hours"


def normalize_trigger_mode(value: str | None) -> str:
    if value in {TRIGGER_CALENDAR, TRIGGER_CONDITION, TRIGGER_CALENDAR_OR_CONDITION}:
        return value
    return TRIGGER_CALENDAR


def latest_running_hours_by_asset(
    db: Session,
    tenant_id: int,
    asset_ids: Iterable[int],
) -> dict[int, AssetConditionReading]:
    ids = {asset_id for asset_id in asset_ids if asset_id}
    if not ids:
        return {}

    rows = (
        db.query(AssetConditionReading)
        .filter(
            AssetConditionReading.tenant_id == tenant_id,
            AssetConditionReading.asset_id.in_(ids),
            AssetConditionReading.metric == METRIC_RUNNING_HOURS,
        )
        .order_by(AssetConditionReading.asset_id.asc(), AssetConditionReading.recorded_at.desc(), AssetConditionReading.id.desc())
        .all()
    )

    latest: dict[int, AssetConditionReading] = {}
    for row in rows:
        if row.asset_id not in latest:
            latest[row.asset_id] = row
    return latest


def calendar_due_at(task: AttivitaManutenzione) -> datetime | None:
    if task.next_due_at:
        return _as_aware(task.next_due_at)
    if task.prossima_scadenza:
        return _as_aware(task.prossima_scadenza)
    if task.frequenza_giorni:
        base = _as_aware(task.last_generated_at) or _as_aware(task.ultima_esecuzione)
        if base:
            return base + timedelta(days=task.frequenza_giorni)
    return None


def condition_status(
    task: AttivitaManutenzione,
    latest_reading: AssetConditionReading | None,
) -> dict:
    threshold = task.condition_threshold_hours
    last_done = task.condition_last_done_hours or 0
    current = latest_reading.value if latest_reading else None
    due_at_hours = last_done + threshold if threshold is not None else None
    remaining = due_at_hours - current if due_at_hours is not None and current is not None else None

    return {
        "metric": task.condition_metric or METRIC_RUNNING_HOURS,
        "current_hours": current,
        "threshold_hours": threshold,
        "last_done_hours": task.condition_last_done_hours,
        "due_at_hours": due_at_hours,
        "remaining_hours": remaining,
        "is_due": remaining is not None and remaining <= 0,
        "recorded_at": latest_reading.recorded_at.isoformat() if latest_reading else None,
    }


def task_due_summary(
    task: AttivitaManutenzione,
    latest_reading: AssetConditionReading | None = None,
    now: datetime | None = None,
) -> dict:
    now = now or datetime.now(timezone.utc)
    trigger_mode = normalize_trigger_mode(task.trigger_mode)
    cal_due = calendar_due_at(task)
    cond = condition_status(task, latest_reading)

    effective_kind = "calendar"
    effective_due_at = cal_due
    days_remaining = (cal_due.date() - now.date()).days if cal_due else None

    if trigger_mode == TRIGGER_CONDITION:
        effective_kind = "condition"
        effective_due_at = now if cond["is_due"] else None
        days_remaining = 0 if cond["is_due"] else None
    elif trigger_mode == TRIGGER_CALENDAR_OR_CONDITION and cond["is_due"]:
        effective_kind = "condition"
        effective_due_at = now
        days_remaining = 0

    return {
        "trigger_mode": trigger_mode,
        "calendar_due_at": cal_due,
        "condition": cond,
        "effective_kind": effective_kind,
        "effective_due_at": effective_due_at,
        "days_remaining": days_remaining,
    }


def _as_aware(dt: datetime | None) -> datetime | None:
    if not dt:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt
