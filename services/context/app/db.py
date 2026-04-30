"""Database access — single asyncpg pool plus a SQLAlchemy async engine for ORM-shaped writes.

Schema split:
- 'app' schema is Prisma-owned (Next.js writes only).
- 'rag' schema is this service's exclusive write surface.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import asyncpg
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from .config import get_settings

_pool: asyncpg.Pool | None = None
_engine = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def _sync_url(url: str) -> str:
    """Convert asyncpg URL to a sync libpq URL for asyncpg.create_pool."""
    if url.startswith("postgresql+asyncpg://"):
        return "postgresql://" + url[len("postgresql+asyncpg://") :]
    return url


async def init_pool() -> asyncpg.Pool:
    """Initialize the global asyncpg pool. Call once on app startup."""
    global _pool
    if _pool is None:
        settings = get_settings()
        _pool = await asyncpg.create_pool(
            dsn=_sync_url(settings.database_url),
            min_size=2,
            max_size=10,
            command_timeout=30,
        )
        # Ensure pgvector + the rag schema exist. Idempotent.
        async with _pool.acquire() as conn:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            await conn.execute(f'CREATE SCHEMA IF NOT EXISTS "{settings.rag_schema}"')
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_engine():
    """Lazy SQLAlchemy async engine for ORM-shaped writes (entities, identities, cursors)."""
    global _engine, _sessionmaker
    if _engine is None:
        settings = get_settings()
        _engine = create_async_engine(
            settings.database_url,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=5,
        )
        _sessionmaker = async_sessionmaker(_engine, expire_on_commit=False)
    return _engine


@asynccontextmanager
async def session() -> AsyncIterator[AsyncSession]:
    get_engine()
    assert _sessionmaker is not None
    async with _sessionmaker() as s:
        yield s


@asynccontextmanager
async def acquire() -> AsyncIterator[asyncpg.Connection]:
    pool = await init_pool()
    async with pool.acquire() as conn:
        yield conn
