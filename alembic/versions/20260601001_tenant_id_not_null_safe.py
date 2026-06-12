"""tenant_id_backfill

Revision ID: 20260601001
Revises: fa2e7d5c222b
Create Date: 2026-06-01

P1-09 Step 1/2: Backfill tenant_id NULL -> MIN(tenant) sui modelli operativi.
Solo DML (UPDATE), nessun DDL. Fast e non blocca.
Il NOT NULL constraint viene aggiunto dalla migration successiva (20260601002)
dopo che questo commit ha rilasciato tutti i RowExclusiveLock.
"""
import logging
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

log = logging.getLogger(__name__)

revision: str = '20260601001'
down_revision: Union[str, Sequence[str], None] = 'fa2e7d5c222b'
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


def upgrade() -> None:
    bind = op.get_bind()

    row = bind.execute(sa.text("SELECT MIN(id) FROM tenants")).fetchone()
    fallback_tid: int = row[0] if row and row[0] is not None else 1

    for table in OPERATIONAL_TABLES:
        if not _table_exists(bind, table):
            continue
        if not _column_exists(bind, table, 'tenant_id'):
            continue
        result = bind.execute(
            # nosemgrep: python.sqlalchemy.security.audit.avoid-sqlalchemy-text.avoid-sqlalchemy-text -- identificatore da OPERATIONAL_TABLES (lista hardcoded), valori parametrizzati
            sa.text(f"UPDATE {table} SET tenant_id = :tid WHERE tenant_id IS NULL"),
            {"tid": fallback_tid},
        )
        if result.rowcount:
            log.info("P1-09 backfill: %s righe aggiornate su %s", result.rowcount, table)


def downgrade() -> None:
    pass  # il backfill e' irreversibile in modo sicuro
