"""Alembic env — uses DATABASE_URL from app config so migration target = runtime target."""
from __future__ import annotations

import os
import sys
from logging.config import fileConfig
from pathlib import Path

from alembic import context
from sqlalchemy import engine_from_config, pool

# Make app importable
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import get_settings  # noqa: E402

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Override sqlalchemy.url from runtime settings (psycopg2 driver for Alembic)
_runtime_url = get_settings().database_url
_sync_url = (
    _runtime_url.replace("postgresql+asyncpg://", "postgresql+psycopg2://")
    if _runtime_url.startswith("postgresql+asyncpg://")
    else _runtime_url
)
config.set_main_option("sqlalchemy.url", _sync_url)

# We define schema with raw SQL in versions/, no SQLAlchemy declarative metadata required.
target_metadata = None


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
