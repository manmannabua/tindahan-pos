"""Short-lived Redis cache for public catalog responses.

Anonymous traffic (shoppers, scrapers) must not load the database the POS sync depends on, so
public responses are cached for a few seconds per store + query. Keys include a per-company
version number; publishing/unpublishing or changing the settings bumps it, so owners see their
changes at once instead of after the TTL. Stock changes simply age out (TTL).

Redis is never the source of truth here: on any Redis error the response is computed directly.
"""

import hashlib
import uuid
from collections.abc import Awaitable, Callable

from redis.exceptions import RedisError

from app.core.logging import get_logger
from app.core.redis import get_redis

log = get_logger(__name__)
PUBLIC_TTL_SECONDS = 30


def _version_key(company_id: uuid.UUID) -> str:
    return f"pub:v:{company_id}"


async def invalidate(company_id: uuid.UUID) -> None:
    try:
        await get_redis().incr(_version_key(company_id))
    except RedisError:
        log.warning("storefront.cache_invalidate_failed", company_id=str(company_id))


async def cached_json(
    company_id: uuid.UUID, key: str, produce: Callable[[], Awaitable[str]]
) -> str:
    redis = get_redis()
    try:
        version = await redis.get(_version_key(company_id))
        digest = hashlib.sha256(key.encode()).hexdigest()[:32]
        cache_key = f"pub:{company_id}:{int(version or 0)}:{digest}"
        hit = await redis.get(cache_key)
    except RedisError:
        return await produce()
    if hit is not None:
        return hit.decode() if isinstance(hit, bytes) else str(hit)
    body = await produce()
    try:
        await redis.set(cache_key, body, ex=PUBLIC_TTL_SECONDS)
    except RedisError:
        log.warning("storefront.cache_store_failed", company_id=str(company_id))
    return body
