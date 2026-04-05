"""Add planning fields to asset and generated_plans table

Revision ID: 20260405001
Revises: 35093982921a
Create Date: 2026-04-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260405001'
down_revision: Union[str, Sequence[str], None] = '35093982921a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Aggiungi colonne di AI Planning al modello Asset
    with op.batch_alter_table('asset', schema=None) as batch_op:
        batch_op.add_column(sa.Column('weather_constraint', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('fermo_on_schedule', sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column('latitude', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('longitude', sa.Float(), nullable=True))

    # Crea tabella generated_plans
    op.create_table(
        'generated_plans',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('horizon_days', sa.Integer(), nullable=True),
        sa.Column('plan_json', sa.JSON(), nullable=True),
        sa.Column('confirmed_at', sa.DateTime(), nullable=True),
        sa.Column('tenant_id', sa.Integer(), sa.ForeignKey('tenants.id'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_generated_plans_id'), 'generated_plans', ['id'], unique=False)
    op.create_index(op.f('ix_generated_plans_tenant_id'), 'generated_plans', ['tenant_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    # Rimuovi tabella generated_plans
    op.drop_index(op.f('ix_generated_plans_tenant_id'), table_name='generated_plans')
    op.drop_index(op.f('ix_generated_plans_id'), table_name='generated_plans')
    op.drop_table('generated_plans')

    # Rimuovi colonne da asset
    with op.batch_alter_table('asset', schema=None) as batch_op:
        batch_op.drop_column('longitude')
        batch_op.drop_column('latitude')
        batch_op.drop_column('fermo_on_schedule')
        batch_op.drop_column('weather_constraint')
