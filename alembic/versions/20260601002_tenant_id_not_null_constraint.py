"""tenant_id_not_null_constraint

Revision ID: 20260601002
Revises: 20260601001
Create Date: 2026-06-01

P1-09 Step 2/2: Aggiunge NOT NULL constraint su tenant_id dei modelli operativi.
Gira DOPO che 20260601001 ha committato il backfill, quindi nessun
RowExclusiveLock aperto — ALTER TABLE puo' acquisire AccessExclusiveLock libero.

SQLite: batch_alter_table (necessario).
PostgreSQL: ALTER TABLE ... SET NOT NULL nativo (fast se nessun NULL esiste).
"""
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

log = logging.getLogger(__name__)

revision: str = '20260601002'
down_revision: Union[str, Sequence[str], None] = '20260601001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

OPERATIONAL_TABLES = [
    'siti', 'impianti', 'asset', 'tecnici', 'ticket',
    'manuali', 'attivita_manutenzione', 'analisi_guasti',
    'diagnostic_sessions', 'tecnici_assenze', 'ticket_allegati',
    'generated_plans', 'piani_manutenzione',
]


def _table_exists(conn, table_name: str) -> bool:
    from sqlalchemy import inspect as sa_inspect
    return table_name in sa_inspect(conn).get_table_names()


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    from sqlalchemy import inspect as sa_inspect
    insp = sa_inspect(conn)
    if table_name not in insp.get_table_names():
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def _is_already_not_null(conn, table_name: str, column_name: str) -> bool:
    from sqlalchemy import inspect as sa_inspect
    cols = sa_inspect(conn).get_columns(table_name)
    col = next((c for c in cols if c["name"] == column_name), None)
    return col is not None and not col["nullable"]


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    for table in OPERATIONAL_TABLES:
        if not _table_exists(bind, table):
            continue
        if not _column_exists(bind, table, 'tenant_id'):
            continue
        if _is_already_not_null(bind, table, 'tenant_id'):
            log.info("P1-09: %s.tenant_id gia' NOT NULL, skip.", table)
            continue

        if dialect == 'sqlite':
            with op.batch_alter_table(table) as batch_op:
                batch_op.alter_column('tenant_id', existing_type=sa.Integer(), nullable=False)
        else:
            # Nessuna transazione aperta dalla migration precedente (e' stata committata).
            # ALTER TABLE acquisce AccessExclusiveLock senza deadlock.
            bind.execute(
                sa.text(f"ALTER TABLE {table} ALTER COLUMN tenant_id SET NOT NULL")
            )
        log.info("P1-09: NOT NULL applicato su %s.tenant_id", table)


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    for table in reversed(OPERATIONAL_TABLES):
        if not _table_exists(bind, table):
            continue
        if not _column_exists(bind, table, 'tenant_id'):
            continue
        if not _is_already_not_null(bind, table, 'tenant_id'):
            continue

        if dialect == 'sqlite':
            with op.batch_alter_table(table) as batch_op:
                batch_op.alter_column('tenant_id', existing_type=sa.Integer(), nullable=True)
        else:
            bind.execute(
                sa.text(f"ALTER TABLE {table} ALTER COLUMN tenant_id DROP NOT NULL")
            )
