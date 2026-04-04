"""v2_baseline_full_schema

Baseline migration che rappresenta lo schema completo al momento
dell'integrazione di Alembic come strumento ufficiale di migrazione.

Le tabelle esistono già sul DB di produzione (create via init_db).
Eseguire UNA VOLTA SOLA: alembic stamp a1b2c3d4e5f6

Revision ID: a1b2c3d4e5f6
Revises: 6f6d520003da
Create Date: 2026-03-31

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = '6f6d520003da'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Baseline: le tabelle esistono già. Questa migrazione è un no-op.
    Esegui `alembic stamp a1b2c3d4e5f6` sul DB di produzione invece di upgrade.
    """
    pass


def downgrade() -> None:
    pass
