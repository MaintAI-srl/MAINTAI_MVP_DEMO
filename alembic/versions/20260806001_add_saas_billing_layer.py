"""Livello commerciale SaaS: abbonamenti, eventi billing, consumi, token e onboarding

Revision ID: 20260806001
Revises: 20260720001
Create Date: 2026-08-06

Aggiunge il livello che rende MaintAI vendibile in self-service:

- `subscriptions`         — piano, stato e periodo di ciascun tenant
- `subscription_events`   — eventi del provider, con UNIQUE per l'idempotenza
- `usage_counters`        — consumi di flusso (chiamate AI) per periodo
- `auth_tokens`           — token monouso di verifica email e reset password
- `onboarding_progress`   — avanzamento del wizard di attivazione
- colonne anagrafiche/fiscali su `tenants` e di identità su `utenti`

**Retrocompatibile per costruzione**: nessuna colonna NOT NULL senza default su
tabelle esistenti, e nessun tenant riceve un abbonamento. Un tenant senza riga
in `subscriptions` continua a funzionare senza limiti (vedi la nota
"grandfathered" in `entitlement_service.py`): il livello commerciale si attiva
sottoscrivendo, non si subisce al primo deploy.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260806001"
down_revision: Union[str, Sequence[str], None] = "20260720001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_columns(table: str) -> set[str]:
    inspector = sa.inspect(op.get_bind())
    try:
        return {col["name"] for col in inspector.get_columns(table)}
    except Exception:
        return set()


def _existing_tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _existing_tables()

    # ── Colonne su tabelle esistenti ─────────────────────────────────────────
    tenant_cols = _existing_columns("tenants")
    with op.batch_alter_table("tenants") as batch:
        for name, column in (
            ("legal_name", sa.Column("legal_name", sa.String(), nullable=True)),
            ("vat_number", sa.Column("vat_number", sa.String(), nullable=True)),
            ("billing_email", sa.Column("billing_email", sa.String(), nullable=True)),
            ("country", sa.Column("country", sa.String(), nullable=True)),
            ("onboarding_status", sa.Column("onboarding_status", sa.String(), nullable=True, server_default="pending")),
            ("onboarding_completed_at", sa.Column("onboarding_completed_at", sa.DateTime(), nullable=True)),
            ("deletion_requested_at", sa.Column("deletion_requested_at", sa.DateTime(), nullable=True)),
        ):
            if name not in tenant_cols:
                batch.add_column(column)

    utenti_cols = _existing_columns("utenti")
    with op.batch_alter_table("utenti") as batch:
        for name, column in (
            ("email", sa.Column("email", sa.String(), nullable=True)),
            ("email_verified_at", sa.Column("email_verified_at", sa.DateTime(), nullable=True)),
            ("is_tenant_owner", sa.Column("is_tenant_owner", sa.Boolean(), nullable=True, server_default=sa.false())),
        ):
            if name not in utenti_cols:
                batch.add_column(column)
    if "email" not in utenti_cols:
        op.create_index("ix_utenti_email", "utenti", ["email"])

    # ── subscriptions ────────────────────────────────────────────────────────
    if "subscriptions" not in tables:
        op.create_table(
            "subscriptions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("provider", sa.String(), nullable=False, server_default="local"),
            sa.Column("provider_customer_id", sa.String(), nullable=True),
            sa.Column("provider_subscription_id", sa.String(), nullable=True),
            sa.Column("plan_code", sa.String(), nullable=False, server_default="trial"),
            sa.Column("status", sa.String(), nullable=False, server_default="trialing"),
            sa.Column("billing_interval", sa.String(), nullable=False, server_default="monthly"),
            sa.Column("currency", sa.String(), nullable=False, server_default="EUR"),
            sa.Column("extra_users", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("extra_sites", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("trial_ends_at", sa.DateTime(), nullable=True),
            sa.Column("current_period_start", sa.DateTime(), nullable=True),
            sa.Column("current_period_end", sa.DateTime(), nullable=True),
            sa.Column("cancel_at_period_end", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("cancelled_at", sa.DateTime(), nullable=True),
            sa.Column("grace_period_ends_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
        )
        # UNIQUE: un tenant ha un solo abbonamento. Due righe significherebbero
        # due verità sul suo piano, e nessun modo di sapere quale vale.
        op.create_index("ix_subscriptions_tenant_id", "subscriptions", ["tenant_id"], unique=True)
        op.create_index("ix_subscriptions_status", "subscriptions", ["status"])
        op.create_index("ix_subscriptions_provider_customer", "subscriptions", ["provider_customer_id"])
        op.create_index("ix_subscriptions_provider_sub", "subscriptions", ["provider_subscription_id"])

    # ── subscription_events ──────────────────────────────────────────────────
    if "subscription_events" not in tables:
        op.create_table(
            "subscription_events",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
            sa.Column("subscription_id", sa.Integer(), sa.ForeignKey("subscriptions.id"), nullable=True),
            sa.Column("provider", sa.String(), nullable=False, server_default="local"),
            sa.Column("provider_event_id", sa.String(), nullable=False),
            sa.Column("event_type", sa.String(), nullable=False),
            sa.Column("payload_hash", sa.String(), nullable=True),
            sa.Column("processing_status", sa.String(), nullable=False, server_default="received"),
            sa.Column("processed_at", sa.DateTime(), nullable=True),
            sa.Column("error_message", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        # Questo indice UNIQUE *è* la garanzia di idempotenza dei webhook:
        # la seconda consegna dello stesso evento fallisce l'INSERT e viene
        # scartata. Rimuoverlo significa riapplicare pagamenti e disdette.
        op.create_index(
            "ix_subscription_events_event_id", "subscription_events", ["provider_event_id"], unique=True
        )
        op.create_index("ix_subscription_events_tenant", "subscription_events", ["tenant_id"])
        op.create_index("ix_subscription_events_type", "subscription_events", ["event_type"])
        op.create_index("ix_subscription_events_status", "subscription_events", ["processing_status"])
        op.create_index("ix_subscription_events_created", "subscription_events", ["created_at"])

    # ── usage_counters ───────────────────────────────────────────────────────
    if "usage_counters" not in tables:
        op.create_table(
            "usage_counters",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("metric_code", sa.String(), nullable=False),
            sa.Column("period_start", sa.DateTime(), nullable=False),
            sa.Column("period_end", sa.DateTime(), nullable=False),
            sa.Column("used_value", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("tenant_id", "metric_code", "period_start", name="uq_usage_tenant_metric_period"),
        )
        op.create_index("ix_usage_counters_tenant", "usage_counters", ["tenant_id"])
        op.create_index("ix_usage_counters_metric", "usage_counters", ["metric_code"])

    # ── auth_tokens ──────────────────────────────────────────────────────────
    if "auth_tokens" not in tables:
        op.create_table(
            "auth_tokens",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("utenti.id"), nullable=False),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=True),
            sa.Column("purpose", sa.String(), nullable=False),
            sa.Column("token_hash", sa.String(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_auth_tokens_hash", "auth_tokens", ["token_hash"], unique=True)
        op.create_index("ix_auth_tokens_user", "auth_tokens", ["user_id"])
        op.create_index("ix_auth_tokens_tenant", "auth_tokens", ["tenant_id"])
        op.create_index("ix_auth_tokens_purpose", "auth_tokens", ["purpose"])

    # ── onboarding_progress ──────────────────────────────────────────────────
    if "onboarding_progress" not in tables:
        op.create_table(
            "onboarding_progress",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("tenant_id", sa.Integer(), sa.ForeignKey("tenants.id"), nullable=False),
            sa.Column("step_code", sa.String(), nullable=False),
            sa.Column("status", sa.String(), nullable=False, server_default="pending"),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("skipped_at", sa.DateTime(), nullable=True),
            sa.Column("data_json", sa.Text(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("tenant_id", "step_code", name="uq_onboarding_tenant_step"),
        )
        op.create_index("ix_onboarding_progress_tenant", "onboarding_progress", ["tenant_id"])


def downgrade() -> None:
    for table in ("onboarding_progress", "auth_tokens", "usage_counters", "subscription_events", "subscriptions"):
        op.drop_table(table)

    with op.batch_alter_table("utenti") as batch:
        for name in ("is_tenant_owner", "email_verified_at", "email"):
            batch.drop_column(name)

    with op.batch_alter_table("tenants") as batch:
        for name in (
            "deletion_requested_at", "onboarding_completed_at", "onboarding_status",
            "country", "billing_email", "vat_number", "legal_name",
        ):
            batch.drop_column(name)
