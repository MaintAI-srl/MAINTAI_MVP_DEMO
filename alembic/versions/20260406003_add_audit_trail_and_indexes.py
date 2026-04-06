"""Add ticket.created_by audit field and composite tenant indexes

Revision ID: 20260406003
Revises: 20260406002
Create Date: 2026-04-06

- ticket.created_by: username JWT di chi ha aperto il ticket (audit trail)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '20260406003'
down_revision: Union[str, Sequence[str], None] = '20260406002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('ticket', schema=None) as batch_op:
        batch_op.add_column(sa.Column('created_by', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('ticket', schema=None) as batch_op:
        batch_op.drop_column('created_by')
