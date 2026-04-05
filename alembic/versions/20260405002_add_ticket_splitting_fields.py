"""Add ticket splitting fields

Revision ID: 20260405002
Revises: 20260405001
Create Date: 2026-04-05 00:01:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260405002'
down_revision: Union[str, Sequence[str], None] = '20260405001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Aggiungi campi di splitting/pianificazione AI alla tabella ticket."""
    with op.batch_alter_table('ticket', schema=None) as batch_op:
        batch_op.add_column(sa.Column('parent_ticket_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('is_continuation', sa.Boolean(), nullable=True, server_default='0'))
        batch_op.add_column(sa.Column('planned_start_time', sa.Time(), nullable=True))
        batch_op.create_foreign_key('fk_ticket_parent_ticket_id', 'ticket', ['parent_ticket_id'], ['id'])


def downgrade() -> None:
    """Rimuovi campi di splitting dalla tabella ticket."""
    with op.batch_alter_table('ticket', schema=None) as batch_op:
        batch_op.drop_constraint('fk_ticket_parent_ticket_id', type_='foreignkey')
        batch_op.drop_column('planned_start_time')
        batch_op.drop_column('is_continuation')
        batch_op.drop_column('parent_ticket_id')
