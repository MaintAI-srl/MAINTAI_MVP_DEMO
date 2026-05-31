"""tenant_id NOT NULL on operative models (P1-09)

Revision ID: 20260531001
Revises: c8b3fc6efac0
Create Date: 2026-05-31
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260531001"
down_revision: Union[str, Sequence[str], None] = "c8b3fc6efac0"
branch_labels = None
depends_on = None

# All operative tables where tenant_id was nullable=True (original HEAD).
# Skipped intentionally:
#   - utenti: tenant association is optional (pre-invite state)
#   - system_logs: global infra logs, may exist before tenant context
#   - failure_modes: has is_global flag — records shared across tenants
#   - asset_documenti: was already nullable=False before this migration
TABLES = [
    "siti",
    "impianti",
    "asset",
    "tecnici",
    "ticket",
    "manuali",
    "attivita_manutenzione",
    "asset_condition_readings",
    "analisi_guasti",
    "diagnostic_sessions",
    "tecnici_assenze",
    "ticket_allegati",
    "email_config",
    "piani_manutenzione",
    "generated_plans",
    "planner_feedback",
    "failure_analysis",
    "diagnostic_learning",
    "procedure",
    "note_asset",
    "check_primo_livello",
    "attestati",
]


def upgrade() -> None:
    for table in TABLES:
        op.execute(f"UPDATE {table} SET tenant_id = 1 WHERE tenant_id IS NULL")
        with op.batch_alter_table(table) as batch_op:
            batch_op.alter_column(
                "tenant_id",
                existing_type=sa.Integer(),
                nullable=False,
            )


def downgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table) as batch_op:
            batch_op.alter_column(
                "tenant_id",
                existing_type=sa.Integer(),
                nullable=True,
            )
