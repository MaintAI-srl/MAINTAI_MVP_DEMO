"""
Adaptive Duration Estimator — stima adattiva della durata dei ticket.

Analizza lo storico del PlannerFeedback per calcolare un fattore correttivo
da applicare alla durata stimata prima della pianificazione.

Principio: se i PM sull'asset X hanno storicamente richiesto il 40% in più
del tempo stimato, il planner pianificherà già col fattore 1.4 invece di 1.0,
migliorando la capacità del piano di rispettare i tempi.

Importante: questo modulo NON modifica il DB — aggiusta solo l'input al planner.
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.orm import Session

from backend.db.modelli import PlannerFeedback

logger = logging.getLogger(__name__)


def get_duration_correction_factor(
    db: Session,
    ticket_tipo: str,
    asset_id: Optional[int],
    tenant_id: int,
    lookback_days: int = 90,
    min_records: int = 5,
) -> float:
    """
    Ritorna il fattore moltiplicativo per la durata stimata basato su storico feedback.

    Esempio:
    - I PM su asset 42 hanno impiegato mediamente il 40% in più del previsto → 1.4
    - Dati insufficienti (< min_records) → 1.0 (nessuna correzione)

    Il fattore è cappato in [0.5, 3.0] per evitare outlier che compromettono la pianificazione.

    Args:
        db: sessione DB corrente
        ticket_tipo: tipo ticket ("BD", "PM", "CM")
        asset_id: ID asset (può essere None → filtra solo per tipo)
        tenant_id: isolamento multi-tenant obbligatorio
        lookback_days: finestra temporale retroattiva (default: 90 giorni)
        min_records: numero minimo di record per applicare la correzione

    Returns:
        float: fattore moltiplicativo (1.0 = nessuna correzione)
    """
    from datetime import datetime, timedelta, timezone

    since = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    query = db.query(PlannerFeedback).filter(
        PlannerFeedback.tenant_id == tenant_id,
        PlannerFeedback.ticket_tipo == ticket_tipo,
        PlannerFeedback.actual_duration_hours.isnot(None),
        PlannerFeedback.estimated_duration_hours.isnot(None),
        PlannerFeedback.estimated_duration_hours > 0,
        PlannerFeedback.created_at >= since,
        PlannerFeedback.execution_outcome.in_(["completed", "partial"]),
    )

    if asset_id is not None:
        query = query.filter(PlannerFeedback.asset_id == asset_id)

    records = query.all()

    if len(records) < min_records:
        logger.debug(
            "AdaptiveEstimator: dati insufficienti per tipo=%s asset=%s tenant=%s "
            "(trovati %d, minimo %d) — fattore=1.0",
            ticket_tipo, asset_id, tenant_id, len(records), min_records,
        )
        return 1.0

    # Calcola AVG(actual / estimated)
    ratios = [
        r.actual_duration_hours / r.estimated_duration_hours
        for r in records
        if r.actual_duration_hours and r.estimated_duration_hours
    ]

    if not ratios:
        return 1.0

    avg_ratio = sum(ratios) / len(ratios)

    # Cap in [0.5, 3.0]
    factor = max(0.5, min(3.0, avg_ratio))

    if abs(factor - 1.0) > 0.05:
        logger.info(
            "AdaptiveEstimator: tipo=%s asset=%s tenant=%s → fattore=%.2f "
            "(basato su %d record, avg_ratio=%.2f)",
            ticket_tipo, asset_id, tenant_id, factor, len(records), avg_ratio,
        )

    return round(factor, 3)
