"""Redis client.

Redis holds only rebuildable/temporary data: rate-limit counters, device challenges, caches,
locks, presence. Nothing financial lives here.
"""

from functools import lru_cache

from redis.asyncio import Redis

from app.core.config import get_settings


@lru_cache
def get_redis() -> Redis:
    url = get_settings().redis_url
    if url.startswith("fakeredis"):
        import fakeredis  # dev/test only dependency

        return fakeredis.FakeAsyncRedis(decode_responses=True)
    return Redis.from_url(url, decode_responses=True)
