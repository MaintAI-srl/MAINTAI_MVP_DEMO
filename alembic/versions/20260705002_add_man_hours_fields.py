"""add ticket man-hours fields

Revision ID: 20260705002
Revises: 20260705001
Create Date: 2026-07-05 00:00:00.000000

Change request 2026-07-05 — ore uomo sui ticket:
- required_man_hours: ore uomo necessarie (durata × tecnici in modalità auto)
- man_hours_calculation_mode: 'auto' | 'manual' (default manual)

`tecnici_richiesti` e `durata_stimata_ore` esistono già, non vengono duplicati.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260705002'
down_revision: Union[str, Sequence[str], None] = '20260705001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('ticket', schema=None) as batch_op:
        batch_op.add_column(sa.Column('required_man_hours', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('man_hours_calculation_mode', sa.String(), nullable=True, server_default='manual'))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('ticket', schema=None) as batch_op:
        batch_op.drop_column('man_hours_calculation_mode')
        batch_op.drop_column('required_man_hours')
