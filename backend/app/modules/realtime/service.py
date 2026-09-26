"""Realtime events and device presence (Redis).

Realtime is an optional enhancement (docs/ARCHITECTURE.md): publishing never raises, and nothing
in the POS depends on it. Events are published only AFTER the transaction that caused them
committed, so listeners never see something that was rolled back.
"""

import json
import uuid
from datetime import UTC, datetime
from typing import Any

from redis.exceptions import RedisError

from app.core.logging import get_logger
from app.core.redis import get_redis

log = get_logger(__name__)

PRESENCE_TTL_SECONDS = 120


def channel(company_id: uuid.UUID) -> str:
    return f"rt:{company_id}"


async def publish(company_id: uuid.UUID, event: str, data: dict[str, Any]) -> None:
    message = json.dumps(
        {"event": event, "data": data, "at": datetime.now(UTC).isoformat()}, default=str
    )
    try:
        await get_redis().publish(channel(company_id), message)
    except RedisError:
        log.warning("realtime.publish_failed", event_name=event)


async def mark_device_online(device_id: uuid.UUID) -> None:
    try:
        await get_redis().set(f"presence:device:{device_id}", "1", ex=PRESENCE_TTL_SECONDS)
    except RedisError:
        log.warning("realtime.presence_failed", device_id=str(device_id))


async def online_devices(device_ids: list[uuid.UUID]) -> set[uuid.UUID]:
    if not device_ids:
        return set()
    try:
        values = await get_redis().mget([f"presence:device:{d}" for d in device_ids])
    except RedisError:
        return set()
    return {d for d, v in zip(device_ids, values, strict=True) if v}
