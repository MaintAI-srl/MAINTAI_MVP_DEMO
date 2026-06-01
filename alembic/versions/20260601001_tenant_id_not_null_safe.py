"""tenant_id_not_null_safe

Revision ID: 20260601001
Revises: fa2e7d5c222b
Create Date: 2026-06-01

P1-09: Rende tenant_id NOT NULL sui modelli operativi.
Strategia sicura (3 step):
  1. Backfill: UPDATE ... SET tenant_id = <min_tenant> WHERE tenant_id IS NULL
  2. Alter column con approccio dialect-aware:
     - SQLite  → batch_alter_table (unico modo per alterare colonne su SQLite)
     - PostgreSQL → ALTER TABLE ... ALTER COLUMN ... SET NOT NULL (nativo, no table-copy)
  Evita il crash su PostgreSQL causato da batch_alter_table copy-strategy
  con FK complesse (ticket, generated_plans, ecc.)

NON tocca: utenti (superadmin con NULL legittimo), system_logs, failure_modes.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = '20260601001'
down_revision: Union[str, Sequence[str], None] = 'fa2e7d5c222b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OPERATIONAL_TABLES = [
    'siti',
    'impianti',
    'asset',
    'tecnici',
    'ticket',
    'manuali',
    'attivita_manutenzione',
    'analisi_guasti',
    'diagnostic_sessions',
    'tecnici_assenze',
    'ticket_allegati',
    'generated_plans',
    'piani_manutenzione',
]


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    from sqlalchemy import inspect as sa_inspect
    insp = sa_inspect(conn)
    if table_name not in insp.get_table_names():
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def _table_exists(conn, table_name: str) -> bool:
    from sqlalchemy import inspect as sa_inspect
    return table_name in sa_inspect(conn).get_table_names()


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name  # 'sqlite' | 'postgresql'

    # Step 1 — trova il tenant_id di fallback (MIN esistente, default 1)
    row = bind.execute(sa.text("SELECT MIN(id) FROM tenants")).fetchone()
    fallback_tid: int = row[0] if row and row[0] is not None else 1

    for table in OPERATIONAL_TABLES:
        if not _table_exists(bind, table):
            continue
        if not _column_exists(bind, table, 'tenant_id'):
            continue

        # Step 2 — backfill NULL
        bind.execute(
            sa.text(f"UPDATE {table} SET tenant_id = :tid WHERE tenant_id IS NULL"),
            {"tid": fallback_tid},
        )

        # Step 3 — NOT NULL constraint, dialect-aware
        if dialect == 'sqlite':
            # SQLite non supporta ALTER COLUMN nativo → usa batch (ricrea la tabella)
            with op.batch_alter_table(table) as batch_op:
                batch_op.alter_column('tenant_id', existing_type=sa.Integer(), nullable=False)
        else:
            # PostgreSQL (e altri): ALTER TABLE nativo, nessuna copia della tabella
            # Questo evita crash su FK complesse (ticket, generated_plans, ecc.)
            bind.execute(
                sa.text(f"ALTER TABLE {table} ALTER COLUMN tenant_id SET NOT NULL")
            )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    for table in reversed(OPERATIONAL_TABLES):
        if not _table_exists(bind, table):
            continue
        if not _column_exists(bind, table, 'tenant_id'):
            continue

        if dialect == 'sqlite':
            with op.batch_alter_table(table) as batch_op:
                batch_op.alter_column('tenant_id', existing_type=sa.Integer(), nullable=True)
        else:
            bind.execute(
                sa.text(f"ALTER TABLE {table} ALTER COLUMN tenant_id DROP NOT NULL")
            )
