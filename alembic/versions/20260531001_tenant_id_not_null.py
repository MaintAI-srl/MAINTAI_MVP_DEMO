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

# Tables where tenant_id was nullable=True and must become NOT NULL.
# Excluded (intentionally nullable):
#   - system_logs: global infrastructure logs, may exist before tenant context
#   - failure_modes: has is_global flag — records shared across tenants
#   - revoked_tokens: infrastructure, no tenant context
#   - analisi_guasti, diagnostic_sessions: diagnostic data loosely coupled to tenant
#   - failure_analysis, diagnostic_learning: analytics data, may be cross-tenant
TABLES = [
    "tecnici_assenze",
    "ticket_allegati",
    "email_config",
    "generated_plans",
    "planner_feedback",
    "procedure",
    "note_asset",
    "check_primo_livello",
    "attestati",
    "piani_manutenzione",
]


def upgrade() -> None:
    for table in TABLES:
        # Backfill any NULL tenant_id with 1 so the NOT NULL constraint can apply.
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
