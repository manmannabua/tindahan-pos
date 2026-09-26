"""Redis fixed-window rate limiting.

Fail-open: if Redis is unavailable, requests are allowed and a warning is logged. Losing rate
limiting briefly is preferable to locking cashiers out.
"""

from redis.exceptions import RedisError

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.shared.exceptions import RateLimitedError

log = get_logger(__name__)


async def enforce_rate_limit(key: str, *, limit: int, window_seconds: int) -> None:
    if not get_settings().rate_limit_enabled:
        return
    redis = get_redis()
    redis_key = f"rl:{key}"
    try:
        count = await redis.incr(redis_key)
        if count == 1:
            await redis.expire(redis_key, window_seconds)
    except RedisError:
        log.warning("rate_limit.redis_unavailable", key=key)
        return
    if count > limit:
        raise RateLimitedError(
            "Too many requests. Please wait and try again.",
            details={"retry_after_seconds": window_seconds},
        )
