"""add plan_number, confirmed_by, deauthorized fields to generated_plans

Revision ID: 20260405003
Revises: 20260405002
Create Date: 2026-04-05
"""
from alembic import op
import sqlalchemy as sa

revision = '20260405003'
down_revision = '20260405002'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('generated_plans', schema=None) as batch_op:
        batch_op.add_column(sa.Column('plan_number', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('confirmed_by', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('deauthorized_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('deauthorized_by', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('deauthorization_reason', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('generated_plans', schema=None) as batch_op:
        batch_op.drop_column('deauthorization_reason')
        batch_op.drop_column('deauthorized_by')
        batch_op.drop_column('deauthorized_at')
        batch_op.drop_column('confirmed_by')
        batch_op.drop_column('plan_number')
