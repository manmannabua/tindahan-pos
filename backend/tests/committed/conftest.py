"""Fixtures for tests that need REAL commits.

The pull protocol only returns rows written by finished transactions (docs/SYNC_PROTOCOL.md §4),
and concurrency tests need separate connections, so these tests cannot run inside the
rolled-back outer transaction used elsewhere. Each test works in its own company (unique code);
the whole test schema is dropped at the start of the next test session.

This directory sorts after `integration/`, so committed rows never leak into those tests.
"""

import secrets
from collections.abc import AsyncIterator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker

from app.core.database import get_db
from app.core.redis import get_redis
from app.main import app


@pytest_asyncio.fixture(loop_scope="session")
async def sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, expire_on_commit=False)


@pytest_asyncio.fixture(loop_scope="session")
async def committed_client(
    sessionmaker: async_sessionmaker[AsyncSession],
) -> AsyncIterator[AsyncClient]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        async with sessionmaker() as session:
            yield session

    app.dependency_overrides[get_db] = _get_db
    await get_redis().flushall()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Requested-With": "pos"},
    ) as client:
        yield client
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(loop_scope="session")
async def cdb(sessionmaker: async_sessionmaker[AsyncSession]) -> AsyncIterator[AsyncSession]:
    """A session for assertions (sees committed data only)."""
    async with sessionmaker() as session:
        yield session


@pytest_asyncio.fixture
def company_code() -> str:
    return "C" + secrets.token_hex(4).upper()
