"""tenant_id_not_null_safe

Revision ID: 20260601001
Revises: fa2e7d5c222b
Create Date: 2026-06-01

P1-09: Backfill tenant_id NULL -> MIN(tenant) sui modelli operativi.
Poi tenta di aggiungere NOT NULL:
  - SQLite:      batch_alter_table (necessario, nessun ALTER COLUMN nativo)
  - PostgreSQL:  connessione AUTOCOMMIT separata con lock_timeout=5s per
                 non bloccare lo startup; se fallisce logga warning e
                 continua — il backfill resta, l'ORM (nullable=False)
                 impedisce nuovi NULL a livello applicativo.
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


def _apply_not_null_pg(engine, table: str) -> None:
    """Applica NOT NULL su PostgreSQL tramite connessione autocommit separata.

    Usa lock_timeout=5s: se la tabella e' bloccata da lock contention
    l'operazione fallisce in 5 secondi invece di appendere all'infinito.
    Il fallimento viene loggato come warning — non interrompe lo startup.
    """
    try:
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as ac_conn:
            ac_conn.execute(sa.text("SET lock_timeout = '5s'"))
            ac_conn.execute(
                sa.text(f"ALTER TABLE {table} ALTER COLUMN tenant_id SET NOT NULL")
            )
        log.info("P1-09: NOT NULL applicato su %s.tenant_id", table)
    except Exception as exc:
        log.warning(
            "P1-09: NOT NULL su %s.tenant_id rimandato (lock contention o errore: %s). "
            "Backfill eseguito. ORM (nullable=False) garantisce integrita' a livello app.",
            table, exc,
        )


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    # Step 1: tenant_id di fallback per il backfill
    row = bind.execute(sa.text("SELECT MIN(id) FROM tenants")).fetchone()
    fallback_tid: int = row[0] if row and row[0] is not None else 1

    for table in OPERATIONAL_TABLES:
        if not _table_exists(bind, table):
            continue
        if not _column_exists(bind, table, 'tenant_id'):
            continue

        # Step 2: backfill NULL -> fallback_tid (DML, RowExclusiveLock, non blocca)
        bind.execute(
            sa.text(f"UPDATE {table} SET tenant_id = :tid WHERE tenant_id IS NULL"),
            {"tid": fallback_tid},
        )

        # Skip se gia' NOT NULL (idempotente)
        if _is_already_not_null(bind, table, 'tenant_id'):
            log.info("P1-09: %s.tenant_id e' gia' NOT NULL, skip.", table)
            continue

        # Step 3: NOT NULL constraint
        if dialect == 'sqlite':
            with op.batch_alter_table(table) as batch_op:
                batch_op.alter_column('tenant_id', existing_type=sa.Integer(), nullable=False)
        else:
            # PostgreSQL: connessione autocommit separata con lock_timeout
            # Non blocca la transazione principale della migration
            _apply_not_null_pg(bind.engine, table)


def downgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    for table in reversed(OPERATIONAL_TABLES):
        if not _table_exists(bind, table):
            continue
        if not _column_exists(bind, table, 'tenant_id'):
            continue
        if not _is_already_not_null(bind, table, 'tenant_id'):
            continue  # gia' nullable, niente da fare

        if dialect == 'sqlite':
            with op.batch_alter_table(table) as batch_op:
                batch_op.alter_column('tenant_id', existing_type=sa.Integer(), nullable=True)
        else:
            try:
                with bind.engine.connect().execution_options(isolation_level="AUTOCOMMIT") as ac:
                    ac.execute(sa.text("SET lock_timeout = '5s'"))
                    ac.execute(
                        sa.text(f"ALTER TABLE {table} ALTER COLUMN tenant_id DROP NOT NULL")
                    )
            except Exception as exc:
                log.warning("P1-09 downgrade: skip DROP NOT NULL su %s: %s", table, exc)
