from contextlib import suppress
from datetime import UTC, datetime

from fastapi import APIRouter, Response, status
from sqlalchemy import text

from app.core.redis import get_redis
from app.modules.auth.dependencies import DbSession
from app.shared.schemas import ResponseSchema

router = APIRouter(prefix="/health", tags=["health"])


class HealthResponse(ResponseSchema):
    status: str
    server_time: datetime


class ReadinessResponse(HealthResponse):
    database: bool
    redis: bool


@router.get("", response_model=HealthResponse)
async def health() -> HealthResponse:
    """Liveness. Also used by POS terminals as their connectivity probe, so it must be cheap."""
    return HealthResponse(status="ok", server_time=datetime.now(UTC))


@router.get("/ready", response_model=ReadinessResponse)
async def ready(db: DbSession, response: Response) -> ReadinessResponse:
    database = redis = False
    # Readiness reports failures instead of raising them.
    with suppress(Exception):
        await db.execute(text("SELECT 1"))
        database = True
    with suppress(Exception):
        redis = bool(await get_redis().ping())
    ok = database and redis
    if not ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return ReadinessResponse(
        status="ok" if ok else "degraded",
        server_time=datetime.now(UTC),
        database=database,
        redis=redis,
    )
