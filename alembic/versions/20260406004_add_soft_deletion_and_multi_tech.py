"""Add soft deletion, multi-tech field, and unique asset codice per tenant

Revision ID: 20260406004
Revises: 20260406003
Create Date: 2026-04-06

Changes:
- ticket.deleted_at: soft deletion — record non eliminato fisicamente, recuperabile
- ticket.tecnici_richiesti: numero tecnici richiesti per il ticket (default 1)
- asset: unique index parziale (tenant_id, codice) dove codice IS NOT NULL
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '20260406004'
down_revision: Union[str, Sequence[str], None] = '20260406003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('ticket', schema=None) as batch_op:
        batch_op.add_column(sa.Column('deleted_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('tecnici_richiesti', sa.Integer(), nullable=True, server_default='1'))

    # Indice unico parziale: (tenant_id, codice) solo dove codice IS NOT NULL.
    # Garantisce unicità del codice identificativo per tenant senza bloccare asset senza codice.
    # SQLite non supporta CREATE UNIQUE INDEX ... WHERE — usa batch_alter_table solo su PG.
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_asset_tenant_codice
            ON asset (tenant_id, codice)
            WHERE codice IS NOT NULL
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute("DROP INDEX IF EXISTS uq_asset_tenant_codice")

    with op.batch_alter_table('ticket', schema=None) as batch_op:
        batch_op.drop_column('tecnici_richiesti')
        batch_op.drop_column('deleted_at')
