"""Add generated_plans.scadenza and tecnici_assenze.tenant_id

Revision ID: 20260406001
Revises: 20260405003
Create Date: 2026-04-06

Copre colonne gestite fino ad ora solo da _ensure_columns():
- generated_plans.scadenza: max planned_date dei workorder, calcolata alla conferma
- tecnici_assenze.tenant_id: isolamento multi-tenant delle assenze tecnico
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '20260406001'
down_revision: Union[str, Sequence[str], None] = '20260405003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('generated_plans', schema=None) as batch_op:
        batch_op.add_column(sa.Column('scadenza', sa.DateTime(), nullable=True))

    with op.batch_alter_table('tecnici_assenze', schema=None) as batch_op:
        batch_op.add_column(sa.Column('tenant_id', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('tecnici_assenze', schema=None) as batch_op:
        batch_op.drop_column('tenant_id')

    with op.batch_alter_table('generated_plans', schema=None) as batch_op:
        batch_op.drop_column('scadenza')
