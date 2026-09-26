"""Running async service code from Celery tasks.

Celery tasks are synchronous. When a task needs logic that already exists as an async service
(so we don't write it twice), it calls `run_async(fn)`: a fresh event loop and a task-scoped
engine with `NullPool` (connections must not be shared across event loops).
"""

import asyncio
from collections.abc import Awaitable, Callable

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings


def run_async[T](fn: Callable[[AsyncSession], Awaitable[T]]) -> T:
    async def runner() -> T:
        engine = create_async_engine(str(get_settings().database_url), poolclass=NullPool)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                return await fn(session)
        finally:
            await engine.dispose()

    return asyncio.run(runner())
