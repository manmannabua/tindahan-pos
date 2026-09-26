"""Test fixtures.

Integration tests run against a real PostgreSQL database (`pos_test`), because the behaviours
most worth testing — unique constraints, ON CONFLICT, triggers, NUMERIC — are PostgreSQL's.

Isolation: each test runs inside an outer transaction that is rolled back afterwards. Service
code still calls `commit()`; with `join_transaction_mode="create_savepoint"` those commits only
release savepoints inside the outer transaction.
"""

import os
import tempfile
from pathlib import Path

# Settings are read once and cached, so the environment must be set before importing the app.
os.environ.setdefault("TEST_DATABASE_URL", "postgresql+asyncpg://pos:pos@localhost:5432/pos_test")
os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = os.environ["TEST_DATABASE_URL"]
os.environ["REDIS_URL"] = "fakeredis://"
os.environ["COOKIE_SECURE"] = "false"
os.environ["BACKGROUND_JOBS_INLINE"] = "true"  # no Celery worker in tests
os.environ["MEDIA_ROOT"] = str(Path(tempfile.gettempdir()) / "pos-test-media")
os.environ["RATE_LIMIT_ENABLED"] = "true"  # a developer .env may disable it; tests cover it
os.environ["PIN_OFFLINE_ITERATIONS"] = "1000"  # fast tests; production default is 210k

from collections.abc import AsyncIterator
from pathlib import Path

import pytest
import pytest_asyncio
from alembic import command
from alembic.config import Config
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncConnection,
    AsyncEngine,
    AsyncSession,
    create_async_engine,
)

from app.core.database import get_db
from app.core.redis import get_redis
from app.main import app

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _run_migrations(connection: object) -> None:
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    cfg.attributes["connection"] = connection
    command.upgrade(cfg, "head")


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def engine() -> AsyncIterator[AsyncEngine]:
    engine = create_async_engine(os.environ["TEST_DATABASE_URL"])
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA IF EXISTS public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        await conn.run_sync(_run_migrations)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture(loop_scope="session")
async def connection(engine: AsyncEngine) -> AsyncIterator[AsyncConnection]:
    async with engine.connect() as conn:
        trans = await conn.begin()
        yield conn
        await trans.rollback()


@pytest_asyncio.fixture(loop_scope="session")
async def db(connection: AsyncConnection) -> AsyncIterator[AsyncSession]:
    session = AsyncSession(
        bind=connection, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    yield session
    await session.close()


@pytest_asyncio.fixture(loop_scope="session")
async def client(db: AsyncSession) -> AsyncIterator[AsyncClient]:
    async def _get_db() -> AsyncIterator[AsyncSession]:
        yield db

    app.dependency_overrides[get_db] = _get_db
    await get_redis().flushall()
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        headers={"X-Requested-With": "pos"},
    ) as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
