"""Database engines and sessions.

The API uses an async engine (asyncpg). Services receive an `AsyncSession` through the
`get_db` dependency and own the transaction: they call `commit()` exactly once per business
operation. Repositories never commit.
"""

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    return create_async_engine(
        str(settings.database_url),
        echo=settings.db_echo,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_pre_ping=True,
    )


@lru_cache
def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    # expire_on_commit=False: objects stay usable after commit (e.g. to build the response)
    # without triggering a lazy refresh, which async sessions cannot do implicitly.
    return async_sessionmaker(get_engine(), expire_on_commit=False, autoflush=False)


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request, rolled back if not committed."""
    async with get_sessionmaker()() as session:
        yield session


@lru_cache
def get_sync_engine() -> Engine:
    return create_engine(get_settings().sync_database_url, pool_pre_ping=True)


@lru_cache
def get_sync_sessionmaker() -> sessionmaker[Session]:
    """Synchronous sessions for Celery tasks and scripts."""
    return sessionmaker(get_sync_engine(), expire_on_commit=False)
