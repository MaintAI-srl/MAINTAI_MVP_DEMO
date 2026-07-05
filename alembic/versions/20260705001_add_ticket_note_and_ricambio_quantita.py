"""add ticket note and ricambio_quantita fields

Revision ID: 20260705001
Revises: 20260601002
Create Date: 2026-07-05 00:00:00.000000

Aggiunge i campi compilabili in fase di creazione ticket:
- note: note libere del ticket
- ricambio_quantita: quantità ricambio (predisposizione modulo ricambi)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260705001'
down_revision: Union[str, Sequence[str], None] = '20260601002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table('ticket', schema=None) as batch_op:
        batch_op.add_column(sa.Column('note', sa.Text(), nullable=True))
        batch_op.add_column(sa.Column('ricambio_quantita', sa.Float(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('ticket', schema=None) as batch_op:
        batch_op.drop_column('ricambio_quantita')
        batch_op.drop_column('note')
