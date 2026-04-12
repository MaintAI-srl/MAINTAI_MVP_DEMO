"""Add task-plan structural link and backfill v2.5.0 missing fields

Revision ID: 20260411001
Revises: 20260406004
Create Date: 2026-04-11

Changes:
- attivita_manutenzione.piano_id: FK to piani_manutenzione (v2.5.1, critical structural link)
- attivita_manutenzione.is_repeatable: boolean, task è ricorrente (v2.5.1)
- attivita_manutenzione.generation_mode: manual | auto | disabled (v2.5.0 — mancava migrazione)
- attivita_manutenzione.generate_days_before_due: anticipo generazione ticket (v2.5.0)
- attivita_manutenzione.task_stato: active | paused | archived (v2.5.0)
- attivita_manutenzione.source_type: manual_task | imported_from_manual (v2.5.0)
- attivita_manutenzione.last_generated_at: timestamp ultima generazione ticket (v2.5.0)
- attivita_manutenzione.next_due_at: prossima scadenza calcolata (v2.5.0)
- ticket.origin_type: provenienza ticket (v2.5.0 — mancava migrazione)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '20260411001'
down_revision: Union[str, Sequence[str], None] = '20260406004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── attivita_manutenzione ────────────────────────────────────────────────
    with op.batch_alter_table('attivita_manutenzione', schema=None) as batch_op:
        # v2.5.0 — mancavano le migrazioni
        batch_op.add_column(sa.Column('generation_mode', sa.String(), nullable=True, server_default='manual'))
        batch_op.add_column(sa.Column('generate_days_before_due', sa.Integer(), nullable=True, server_default='7'))
        batch_op.add_column(sa.Column('task_stato', sa.String(), nullable=True, server_default='active'))
        batch_op.add_column(sa.Column('source_type', sa.String(), nullable=True))
        batch_op.add_column(sa.Column('last_generated_at', sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column('next_due_at', sa.DateTime(), nullable=True))
        # v2.5.1 — nuovo collegamento strutturale
        batch_op.add_column(sa.Column('piano_id', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('is_repeatable', sa.Boolean(), nullable=True, server_default='1'))

    # FK piano_id → piani_manutenzione.id (separata per batch compatibility SQLite)
    # Su PostgreSQL il batch_alter_table gestisce già le FK. Su SQLite le FK sono
    # decorative (non enforced) quindi l'indice è sufficiente per le query.
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute(
            "ALTER TABLE attivita_manutenzione "
            "ADD CONSTRAINT fk_attivita_piano_id "
            "FOREIGN KEY (piano_id) REFERENCES piani_manutenzione(id)"
        )
        op.execute(
            "CREATE INDEX IF NOT EXISTS ix_attivita_manutenzione_piano_id "
            "ON attivita_manutenzione (piano_id)"
        )

    # ── ticket ───────────────────────────────────────────────────────────────
    with op.batch_alter_table('ticket', schema=None) as batch_op:
        # v2.5.0 — mancava la migrazione
        batch_op.add_column(sa.Column('origin_type', sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('ticket', schema=None) as batch_op:
        batch_op.drop_column('origin_type')

    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        op.execute("DROP INDEX IF EXISTS ix_attivita_manutenzione_piano_id")
        op.execute(
            "ALTER TABLE attivita_manutenzione "
            "DROP CONSTRAINT IF EXISTS fk_attivita_piano_id"
        )

    with op.batch_alter_table('attivita_manutenzione', schema=None) as batch_op:
        batch_op.drop_column('is_repeatable')
        batch_op.drop_column('piano_id')
        batch_op.drop_column('next_due_at')
        batch_op.drop_column('last_generated_at')
        batch_op.drop_column('source_type')
        batch_op.drop_column('task_stato')
        batch_op.drop_column('generate_days_before_due')
        batch_op.drop_column('generation_mode')
