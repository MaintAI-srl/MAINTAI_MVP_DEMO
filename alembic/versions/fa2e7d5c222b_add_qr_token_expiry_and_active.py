"""add_qr_token_expiry_and_active

Revision ID: fa2e7d5c222b
Revises: c8b3fc6efac0
Create Date: 2026-05-31 13:56:27.671512

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'fa2e7d5c222b'
down_revision: Union[str, Sequence[str], None] = 'c8b3fc6efac0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(conn, table_name: str) -> bool:
    from sqlalchemy import inspect as sa_inspect
    insp = sa_inspect(conn)
    return table_name in insp.get_table_names()


def _column_exists(conn, table_name: str, column_name: str) -> bool:
    from sqlalchemy import inspect as sa_inspect
    insp = sa_inspect(conn)
    if table_name not in insp.get_table_names():
        return False
    return any(c["name"] == column_name for c in insp.get_columns(table_name))


def _create_table_if_not_exists(table_name: str, *args, **kwargs) -> None:
    """Crea la tabella solo se non esiste già — idempotente."""
    bind = op.get_bind()
    if not _table_exists(bind, table_name):
        op.create_table(table_name, *args, **kwargs)


def _add_column_if_not_exists(table_name: str, column: sa.Column) -> None:
    """Aggiunge una colonna solo se non esiste già — idempotente."""
    bind = op.get_bind()
    if not _column_exists(bind, table_name, column.name):
        with op.batch_alter_table(table_name) as batch_op:
            batch_op.add_column(column)


def _create_index_if_not_exists(index_name: str, table_name: str, columns, **kwargs) -> None:
    """Crea indice solo se non esiste già."""
    try:
        op.create_index(index_name, table_name, columns, **kwargs)
    except Exception as exc:
        msg = str(exc).lower()
        if "already exists" in msg or "duplicate" in msg:
            pass
        else:
            raise


def upgrade() -> None:
    """Upgrade schema — idempotente, compatibile SQLite e PostgreSQL."""
    # Wrap tutto in try/except per singola operazione: ogni CREATE TABLE / ADD COLUMN
    # che fallisce per "already exists" viene silenziosamente ignorato.
    # Questo garantisce l'idempotenza anche se le tabelle/colonne esistono già nel DB.
    bind = op.get_bind()

    # ── Nuove tabelle (create solo se non esistono) ──────────────────────────

    _create_table_if_not_exists(
        'piani_manutenzione',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('nome_codificato', sa.String(), nullable=False),
        sa.Column('progressivo', sa.Integer(), nullable=False),
        sa.Column('descrizione', sa.Text(), nullable=True),
        sa.Column('stato', sa.String(), nullable=True),
        sa.Column('asset_id', sa.Integer(), nullable=True),
        sa.Column('impianto_id', sa.Integer(), nullable=True),
        sa.Column('sito_id', sa.Integer(), nullable=True),
        sa.Column('manuale_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], ),
        sa.ForeignKeyConstraint(['impianto_id'], ['impianti.id'], ),
        sa.ForeignKeyConstraint(['manuale_id'], ['manuali.id'], ),
        sa.ForeignKeyConstraint(['sito_id'], ['siti.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_piani_manutenzione_id', 'piani_manutenzione', ['id'], unique=False)
    _create_index_if_not_exists('ix_piani_manutenzione_nome_codificato', 'piani_manutenzione', ['nome_codificato'], unique=False)
    _create_index_if_not_exists('ix_piani_manutenzione_progressivo', 'piani_manutenzione', ['progressivo'], unique=False)
    _create_index_if_not_exists('ix_piani_manutenzione_tenant_id', 'piani_manutenzione', ['tenant_id'], unique=False)

    _create_table_if_not_exists(
        'revoked_tokens',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('jti', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_revoked_tokens_id', 'revoked_tokens', ['id'], unique=False)
    _create_index_if_not_exists('ix_revoked_tokens_jti', 'revoked_tokens', ['jti'], unique=True)

    _create_table_if_not_exists(
        'failure_modes',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('asset_type', sa.String(), nullable=False),
        sa.Column('component', sa.String(), nullable=False),
        sa.Column('failure_mode', sa.String(), nullable=False),
        sa.Column('failure_cause', sa.String(), nullable=True),
        sa.Column('failure_effect', sa.String(), nullable=True),
        sa.Column('detection_method', sa.String(), nullable=True),
        sa.Column('recommended_action', sa.String(), nullable=True),
        sa.Column('mtbf_hours', sa.Float(), nullable=True),
        sa.Column('severity', sa.Integer(), nullable=False),
        sa.Column('occurrence', sa.Integer(), nullable=False),
        sa.Column('detectability', sa.Integer(), nullable=False),
        sa.Column('rpn', sa.Integer(), nullable=False),
        sa.Column('peso_appreso', sa.Float(), nullable=True),
        sa.Column('source', sa.String(), nullable=True),
        sa.Column('is_global', sa.Boolean(), nullable=True),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_failure_modes_asset_type', 'failure_modes', ['asset_type'], unique=False)
    _create_index_if_not_exists('ix_failure_modes_id', 'failure_modes', ['id'], unique=False)
    _create_index_if_not_exists('ix_failure_modes_tenant_id', 'failure_modes', ['tenant_id'], unique=False)

    _create_table_if_not_exists(
        'system_logs',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('timestamp', sa.DateTime(), nullable=True),
        sa.Column('level', sa.String(), nullable=True),
        sa.Column('module', sa.String(), nullable=True),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('extra_info', sa.Text(), nullable=True),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_system_logs_id', 'system_logs', ['id'], unique=False)
    _create_index_if_not_exists('ix_system_logs_level', 'system_logs', ['level'], unique=False)
    _create_index_if_not_exists('ix_system_logs_module', 'system_logs', ['module'], unique=False)
    _create_index_if_not_exists('ix_system_logs_tenant_id', 'system_logs', ['tenant_id'], unique=False)
    _create_index_if_not_exists('ix_system_logs_timestamp', 'system_logs', ['timestamp'], unique=False)

    _create_table_if_not_exists(
        'attestati',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tecnico_id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('tipo_corso', sa.String(), nullable=False),
        sa.Column('ente_certificatore', sa.String(), nullable=True),
        sa.Column('data_conseguimento', sa.Date(), nullable=True),
        sa.Column('data_scadenza', sa.Date(), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['tecnico_id'], ['tecnici.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_attestati_tecnico_id', 'attestati', ['tecnico_id'], unique=False)
    _create_index_if_not_exists('ix_attestati_tenant_id', 'attestati', ['tenant_id'], unique=False)

    _create_table_if_not_exists(
        'asset_condition_readings',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('metric', sa.String(), nullable=False),
        sa.Column('value', sa.Float(), nullable=False),
        sa.Column('recorded_at', sa.DateTime(), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_asset_condition_readings_asset_id', 'asset_condition_readings', ['asset_id'], unique=False)
    _create_index_if_not_exists('ix_asset_condition_readings_id', 'asset_condition_readings', ['id'], unique=False)
    _create_index_if_not_exists('ix_asset_condition_readings_metric', 'asset_condition_readings', ['metric'], unique=False)
    _create_index_if_not_exists('ix_asset_condition_readings_recorded_at', 'asset_condition_readings', ['recorded_at'], unique=False)
    _create_index_if_not_exists('ix_asset_condition_readings_tenant_id', 'asset_condition_readings', ['tenant_id'], unique=False)

    _create_table_if_not_exists(
        'asset_documenti',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=False),
        sa.Column('nome', sa.String(), nullable=False),
        sa.Column('tipo', sa.String(), nullable=False),
        sa.Column('filename', sa.String(), nullable=False),
        sa.Column('content_type', sa.String(), nullable=True),
        sa.Column('file_data', sa.LargeBinary(), nullable=False),
        sa.Column('esploso_analisi', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_asset_documenti_asset_id', 'asset_documenti', ['asset_id'], unique=False)
    _create_index_if_not_exists('ix_asset_documenti_id', 'asset_documenti', ['id'], unique=False)
    _create_index_if_not_exists('ix_asset_documenti_tenant_id', 'asset_documenti', ['tenant_id'], unique=False)

    _create_table_if_not_exists(
        'check_primo_livello',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('public_token', sa.String(), nullable=False),
        sa.Column('token_active', sa.Boolean(), server_default='1', nullable=False),
        sa.Column('token_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('voci', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_check_primo_livello_asset_id', 'check_primo_livello', ['asset_id'], unique=False)
    _create_index_if_not_exists('ix_check_primo_livello_public_token', 'check_primo_livello', ['public_token'], unique=True)
    _create_index_if_not_exists('ix_check_primo_livello_tenant_id', 'check_primo_livello', ['tenant_id'], unique=False)

    _create_table_if_not_exists(
        'note_asset',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('testo', sa.Text(), nullable=False),
        sa.Column('autore', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_note_asset_asset_id', 'note_asset', ['asset_id'], unique=False)
    _create_index_if_not_exists('ix_note_asset_tenant_id', 'note_asset', ['tenant_id'], unique=False)

    _create_table_if_not_exists(
        'piani_assets_association',
        sa.Column('piano_id', sa.Integer(), nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], ),
        sa.ForeignKeyConstraint(['piano_id'], ['piani_manutenzione.id'], ),
        sa.PrimaryKeyConstraint('piano_id', 'asset_id')
    )

    _create_table_if_not_exists(
        'procedure',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('asset_id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('titolo', sa.String(), nullable=False),
        sa.Column('tipo', sa.String(), nullable=True),
        sa.Column('passi', sa.Text(), nullable=True),
        sa.Column('revisione', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['asset_id'], ['asset.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_procedure_asset_id', 'procedure', ['asset_id'], unique=False)
    _create_index_if_not_exists('ix_procedure_tenant_id', 'procedure', ['tenant_id'], unique=False)

    _create_table_if_not_exists(
        'diagnostic_learning',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('ticket_id', sa.Integer(), nullable=False),
        sa.Column('symptoms', sa.Text(), nullable=False),
        sa.Column('diagnosed_failure_mode_id', sa.Integer(), nullable=True),
        sa.Column('real_cause', sa.Text(), nullable=False),
        sa.Column('action_taken', sa.Text(), nullable=False),
        sa.Column('resolution_time_minutes', sa.Integer(), nullable=True),
        sa.Column('success', sa.Boolean(), nullable=True),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['diagnosed_failure_mode_id'], ['failure_modes.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['ticket_id'], ['ticket.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_diagnostic_learning_id', 'diagnostic_learning', ['id'], unique=False)
    _create_index_if_not_exists('ix_diagnostic_learning_tenant_id', 'diagnostic_learning', ['tenant_id'], unique=False)

    _create_table_if_not_exists(
        'failure_analysis',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('ticket_id', sa.Integer(), nullable=False),
        sa.Column('failure_mode_id', sa.Integer(), nullable=False),
        sa.Column('probability_score', sa.Float(), nullable=False),
        sa.Column('rpn_weighted', sa.Float(), nullable=False),
        sa.Column('ai_explanation', sa.Text(), nullable=True),
        sa.Column('selected', sa.Boolean(), nullable=True),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['failure_mode_id'], ['failure_modes.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['ticket_id'], ['ticket.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_failure_analysis_id', 'failure_analysis', ['id'], unique=False)
    _create_index_if_not_exists('ix_failure_analysis_tenant_id', 'failure_analysis', ['tenant_id'], unique=False)

    _create_table_if_not_exists(
        'planner_feedback',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=True),
        sa.Column('ticket_id', sa.Integer(), nullable=False),
        sa.Column('generated_plan_id', sa.Integer(), nullable=True),
        sa.Column('planned_date', sa.Date(), nullable=True),
        sa.Column('planned_technician_id', sa.Integer(), nullable=True),
        sa.Column('estimated_duration_hours', sa.Float(), nullable=True),
        sa.Column('confidence_score_at_plan', sa.Float(), nullable=True),
        sa.Column('actual_start', sa.DateTime(), nullable=True),
        sa.Column('actual_finish', sa.DateTime(), nullable=True),
        sa.Column('actual_duration_hours', sa.Float(), nullable=True),
        sa.Column('actual_technician_id', sa.Integer(), nullable=True),
        sa.Column('execution_outcome', sa.String(), nullable=True),
        sa.Column('duration_delta_hours', sa.Float(), nullable=True),
        sa.Column('date_delta_days', sa.Integer(), nullable=True),
        sa.Column('technician_changed', sa.Boolean(), nullable=True),
        sa.Column('user_rating', sa.Integer(), nullable=True),
        sa.Column('user_notes', sa.Text(), nullable=True),
        sa.Column('ticket_tipo', sa.String(), nullable=True),
        sa.Column('asset_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['generated_plan_id'], ['generated_plans.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['ticket_id'], ['ticket.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    _create_index_if_not_exists('ix_planner_feedback_id', 'planner_feedback', ['id'], unique=False)
    _create_index_if_not_exists('ix_planner_feedback_tenant_id', 'planner_feedback', ['tenant_id'], unique=False)
    _create_index_if_not_exists('ix_planner_feedback_ticket_id', 'planner_feedback', ['ticket_id'], unique=False)

    # ── Nuove colonne su tabelle esistenti (idempotente) ──────────────────────

    # asset
    _add_column_if_not_exists('asset', sa.Column('costo_orario_fermo', sa.Float(), nullable=True))
    _add_column_if_not_exists('asset', sa.Column('codice_ricambio_esterno', sa.String(), nullable=True))
    _add_column_if_not_exists('asset', sa.Column('qr_code_b64', sa.Text(), nullable=True))

    # attivita_manutenzione
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('nome', sa.String(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('codice', sa.String(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('generation_mode', sa.String(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('generate_days_before_due', sa.Integer(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('task_stato', sa.String(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('source_type', sa.String(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('last_generated_at', sa.DateTime(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('next_due_at', sa.DateTime(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('trigger_mode', sa.String(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('condition_metric', sa.String(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('condition_threshold_hours', sa.Float(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('condition_last_done_hours', sa.Float(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('piano_id', sa.Integer(), nullable=True))
    _add_column_if_not_exists('attivita_manutenzione', sa.Column('is_repeatable', sa.Boolean(), nullable=True))
    _create_index_if_not_exists('ix_attivita_manutenzione_codice', 'attivita_manutenzione', ['codice'], unique=False)
    _create_index_if_not_exists('ix_attivita_manutenzione_piano_id', 'attivita_manutenzione', ['piano_id'], unique=False)

    # generated_plans
    _create_index_if_not_exists('ix_generated_plans_plan_number', 'generated_plans', ['plan_number'], unique=False)

    # manuali
    _add_column_if_not_exists('manuali', sa.Column('piano_id', sa.Integer(), nullable=True))
    _create_index_if_not_exists('ix_manuali_piano_id', 'manuali', ['piano_id'], unique=False)

    # tecnici
    _add_column_if_not_exists('tecnici', sa.Column('telefono', sa.String(), nullable=True))
    _add_column_if_not_exists('tecnici', sa.Column('sede_indirizzo', sa.String(), nullable=True))

    # ticket
    _add_column_if_not_exists('ticket', sa.Column('created_by', sa.String(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('closed_by', sa.String(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('deleted_at', sa.DateTime(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('tecnici_richiesti', sa.Integer(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('eliminazione_note', sa.Text(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('is_manual_plan', sa.Boolean(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('competenza_richiesta', sa.String(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('piano_manutenzione_id', sa.Integer(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('origine_piano', sa.String(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('origin_type', sa.String(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('sito_name', sa.String(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('impianto_name', sa.String(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('ricambio_note', sa.Text(), nullable=True))
    _add_column_if_not_exists('ticket', sa.Column('in_attesa_ricambio', sa.Boolean(), nullable=True))

    # utenti
    _add_column_if_not_exists('utenti', sa.Column('token_version', sa.Integer(), nullable=True))

    # ── P1-05: check_primo_livello — nuovi campi sicurezza QR ────────────────
    # Questi sono i campi cardine di questa migrazione.
    # Se la tabella esiste già (creata da _ensure_columns), li aggiunge.
    _add_column_if_not_exists(
        'check_primo_livello',
        sa.Column('token_active', sa.Boolean(), server_default='1', nullable=True)
    )
    _add_column_if_not_exists(
        'check_primo_livello',
        sa.Column('token_expires_at', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    """Downgrade schema."""
    # La downgrade rimuove solo le colonne aggiunte in upgrade.
    # Le tabelle create vengono lasciate intatte per sicurezza.
    bind = op.get_bind()

    if _column_exists(bind, 'utenti', 'token_version'):
        with op.batch_alter_table('utenti') as batch_op:
            batch_op.drop_column('token_version')

    if _column_exists(bind, 'check_primo_livello', 'token_expires_at'):
        with op.batch_alter_table('check_primo_livello') as batch_op:
            batch_op.drop_column('token_expires_at')

    if _column_exists(bind, 'check_primo_livello', 'token_active'):
        with op.batch_alter_table('check_primo_livello') as batch_op:
            batch_op.drop_column('token_active')
