"""Add composite tenant_id indexes for query performance

Revision ID: 20260406002
Revises: 20260406001
Create Date: 2026-04-06

Aggiunge indici compositi su (tenant_id, campo_frequente) per le tabelle
principali, riducendo i full-scan sulle query filtrate per tenant.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '20260406002'
down_revision: Union[str, Sequence[str], None] = '20260406001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ticket: query più frequenti = filtro per (tenant_id, stato)
    op.create_index('ix_ticket_tenant_stato', 'ticket', ['tenant_id', 'stato'])
    # ticket: filtro per (tenant_id, priorita) usato nel planner
    op.create_index('ix_ticket_tenant_priorita', 'ticket', ['tenant_id', 'priorita'])
    # asset: (tenant_id, area) usato in filtri dashboard e planner
    op.create_index('ix_asset_tenant_area', 'asset', ['tenant_id', 'area'])
    # generated_plans: (tenant_id, status) usato in history/planning
    op.create_index('ix_generated_plans_tenant_status', 'generated_plans', ['tenant_id', 'status'])
    # tecnici: (tenant_id, stato) usato in filtri disponibilità
    op.create_index('ix_tecnici_tenant_stato', 'tecnici', ['tenant_id', 'stato'])


def downgrade() -> None:
    op.drop_index('ix_tecnici_tenant_stato', table_name='tecnici')
    op.drop_index('ix_generated_plans_tenant_status', table_name='generated_plans')
    op.drop_index('ix_asset_tenant_area', table_name='asset')
    op.drop_index('ix_ticket_tenant_priorita', table_name='ticket')
    op.drop_index('ix_ticket_tenant_stato', table_name='ticket')
