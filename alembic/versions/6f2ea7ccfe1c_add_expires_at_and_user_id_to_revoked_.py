"""add expires_at and user_id to revoked_tokens

Revision ID: 6f2ea7ccfe1c
Revises: 92deed855516
Create Date: 2026-05-13 21:52:10.216812

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6f2ea7ccfe1c'
down_revision: Union[str, Sequence[str], None] = '92deed855516'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('revoked_tokens', schema=None) as batch_op:
        batch_op.add_column(sa.Column('expires_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=True))
        batch_op.create_index('ix_revoked_tokens_expires_at', ['expires_at'], unique=False)


def downgrade() -> None:
    with op.batch_alter_table('revoked_tokens', schema=None) as batch_op:
        batch_op.drop_index('ix_revoked_tokens_expires_at')
        batch_op.drop_column('user_id')
        batch_op.drop_column('expires_at')
