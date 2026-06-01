"""tenant_id_not_null_safe

Revision ID: 20260601001
Revises: fa2e7d5c222b
Create Date: 2026-06-01

P1-09: Backfill tenant_id NULL -> MIN(tenant) sui modelli operativi.
Il NOT NULL constraint viene applicato SOLO dove fattibile senza lock
contention (via SAVEPOINT + lock_timeout su PostgreSQL).
Su SQLite usa batch_alter_table.

Se il constraint non puo' essere applicato (lock atteso > 5s), la migration
continua comunque — il backfill e' sempre committato, il constraint puo'
essere aggiunto manualmente in seguito. L'ORM (nullable=False) garantisce
che nessun nuovo NULL venga inserito a livello applicativo.
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


def _is_nullable(conn, table_name: str, column_name: str) -> bool:
    """Ritorna True se la colonna e' attualmente nullable."""
    from sqlalchemy import inspect as sa_inspect
    cols = sa_inspect(conn).get_columns(table_name)
    col = next((c for c in cols if c["name"] == column_name), None)
    return col["nullable"] if col else True


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # Step 1 — trova il tenant_id di fallback (MIN esistente, default 1)
    row = bind.execute(sa.text("SELECT MIN(id) FROM tenants")).fetchone()
    fallback_tid: int = row[0] if row and row[0] is not None else 1

    for table in OPERATIONAL_TABLES:
        if not _table_exists(bind, table):
            continue
        if not _column_exists(bind, table, 'tenant_id'):
            continue

        # Step 2 — backfill NULL (sempre eseguito, fast RowExclusiveLock)
        bind.execute(
            sa.text(f"UPDATE {table} SET tenant_id = :tid WHERE tenant_id IS NULL"),
            {"tid": fallback_tid},
        )

        # Step 3 — NOT NULL constraint (dialect-aware, non-blocking)
        if already_not_null := not _is_nullable(bind, table, 'tenant_id'):
            log.info("P1-09: %s.tenant_id e' gia' NOT NULL, skip.", table)
            continue

        if dialect == 'sqlite':
            with op.batch_alter_table(table) as batch_op:
                batch_op.alter_column('tenant_id', existing_type=sa.Integer(), nullable=False)
        else:
            # PostgreSQL: ALTER TABLE nativo con lock_timeout + SAVEPOINT
            # Se il lock non e' disponibile in 5s, skippa il constraint
            # (il backfill e' gia' committato nella stessa transazione)
            try:
                bind.execute(sa.text("SET LOCAL lock_timeout = '5s'"))
                bind.execute(sa.text(f"SAVEPOINT sp_not_null_{table}"))
                bind.execute(
                    sa.text(f"ALTER TABLE {table} ALTER COLUMN tenant_id SET NOT NULL")
                )
                bind.execute(sa.text(f"RELEASE SAVEPOINT sp_not_null_{table}"))
                log.info("P1-09: NOT NULL applicato su %s.tenant_id", table)
            except Exception as exc:
                bind.execute(sa.text(f"ROLLBACK TO SAVEPOINT sp_not_null_{table}"))
                log.warning(
                    "P1-09: NOT NULL su %s.tenant_id rimandato (lock contention: %s). "
                    "Backfill eseguito, ORM garantisce nullable=False a livello app.", table, exc
                )


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    for table in reversed(OPERATIONAL_TABLES):
        if not _table_exists(bind, table):
            continue
        if not _column_exists(bind, table, 'tenant_id'):
            continue
        if _is_nullable(bind, table, 'tenant_id'):
            continue  # gia' nullable, niente da fare

        if dialect == 'sqlite':
            with op.batch_alter_table(table) as batch_op:
                batch_op.alter_column('tenant_id', existing_type=sa.Integer(), nullable=True)
        else:
            try:
                bind.execute(sa.text("SET LOCAL lock_timeout = '5s'"))
                bind.execute(sa.text(f"SAVEPOINT sp_downgrade_{table}"))
                bind.execute(
                    sa.text(f"ALTER TABLE {table} ALTER COLUMN tenant_id DROP NOT NULL")
                )
                bind.execute(sa.text(f"RELEASE SAVEPOINT sp_downgrade_{table}"))
            except Exception as exc:
                bind.execute(sa.text(f"ROLLBACK TO SAVEPOINT sp_downgrade_{table}"))
                log.warning("P1-09 downgrade: impossibile rimuovere NOT NULL da %s: %s", table, exc)
