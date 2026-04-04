import os
from logging.config import fileConfig
from pathlib import Path

from dotenv import load_dotenv

from alembic import context

# Carica .env da backend/ (utile quando si esegue alembic da CLI)
load_dotenv(Path(__file__).resolve().parent.parent / "backend" / ".env")

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Override sqlalchemy.url con DATABASE_URL dall'ambiente (sovrascrive alembic.ini)
_db_url = os.getenv("DATABASE_URL")
if _db_url:
    config.set_main_option("sqlalchemy.url", _db_url)

# Interpret the config file for Python logging.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Import ALL models so autogenerate can detect the full schema
from backend.core.database import Base  # noqa: E402
from backend.db.modelli import (  # noqa: E402, F401
    Tenant, Utente, Sito, Impianto, Asset, Tecnico, Ticket,
    Manuale, AttivitaManutenzione, AnalisiGuasto, DiagnosticSession,
    TecnicoAssenza, TicketAllegato, EmailConfig,
)

target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""
    from backend.core.database import engine as project_engine  # noqa: E402

    connectable = project_engine

    with connectable.connect() as connection:
        is_sqlite = str(connectable.url).startswith("sqlite")
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=is_sqlite,  # True solo per SQLite (ALTER TABLE emulation)
            compare_type=True,          # rileva cambi di tipo colonna
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
