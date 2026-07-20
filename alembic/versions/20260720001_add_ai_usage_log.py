"""add ai_usage_log table

Revision ID: 20260720001
Revises: 20260705002
Create Date: 2026-07-20 00:00:00.000000

Agenti AI con trigger manuale (v3.4):
- ai_usage_log: registro run degli agenti e consumi OpenAI con costo stimato in EUR.
  Alimenta il badge "Consumo AI" della topbar e lo storico run per tenant.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260720001'
down_revision: Union[str, Sequence[str], None] = '20260705002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'ai_usage_log',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=False),
        sa.Column('feature', sa.String(), nullable=False),
        sa.Column('model', sa.String(), nullable=True),
        sa.Column('prompt_tokens', sa.Integer(), nullable=True),
        sa.Column('completion_tokens', sa.Integer(), nullable=True),
        sa.Column('cost_eur', sa.Float(), nullable=True),
        sa.Column('status', sa.String(), nullable=True),
        sa.Column('output_md', sa.Text(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_ai_usage_log_id'), 'ai_usage_log', ['id'], unique=False)
    op.create_index(op.f('ix_ai_usage_log_tenant_id'), 'ai_usage_log', ['tenant_id'], unique=False)
    op.create_index(op.f('ix_ai_usage_log_feature'), 'ai_usage_log', ['feature'], unique=False)
    op.create_index(op.f('ix_ai_usage_log_created_at'), 'ai_usage_log', ['created_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_ai_usage_log_created_at'), table_name='ai_usage_log')
    op.drop_index(op.f('ix_ai_usage_log_feature'), table_name='ai_usage_log')
    op.drop_index(op.f('ix_ai_usage_log_tenant_id'), table_name='ai_usage_log')
    op.drop_index(op.f('ix_ai_usage_log_id'), table_name='ai_usage_log')
    op.drop_table('ai_usage_log')
