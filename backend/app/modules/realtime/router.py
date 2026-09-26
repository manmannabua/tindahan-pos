"""WebSocket endpoint: `GET /api/v1/ws`.

Browsers cannot set an Authorization header on WebSockets, and tokens in URLs end up in logs, so
the client authenticates with its first message: `{"type": "auth", "token": "<access token>"}`.
The server then forwards the company's events (`rt:{company_id}` Redis channel).
"""

import asyncio
import contextlib
import json
from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status
from redis.exceptions import RedisError

from app.core.database import get_sessionmaker
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.core.security import InvalidTokenError, TokenType, decode_jwt
from app.modules.realtime.service import channel
from app.modules.users.models import User

router = APIRouter(tags=["realtime"])
log = get_logger(__name__)
AUTH_TIMEOUT_SECONDS = 5
TOKEN_EXPIRED_CLOSE_CODE = 4401


@router.websocket("/ws")
async def realtime(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=AUTH_TIMEOUT_SECONDS)
        message = json.loads(raw)
        claims = decode_jwt(str(message.get("token", "")))
        if message.get("type") != "auth" or claims.token_type != TokenType.ACCESS:
            raise InvalidTokenError("bad auth message")
    except (TimeoutError, ValueError, InvalidTokenError, WebSocketDisconnect):
        with contextlib.suppress(RuntimeError):
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    async with get_sessionmaker()() as db:
        user = await db.get(User, claims.subject)
    if user is None or not user.is_active or user.company_id != claims.company_id:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.send_json({"event": "connected"})
    pubsub = get_redis().pubsub()
    try:
        await pubsub.subscribe(channel(claims.company_id))
        while True:
            if datetime.now(UTC) >= claims.expires_at:
                # The client reconnects with a fresh access token.
                await websocket.close(code=TOKEN_EXPIRED_CLOSE_CODE)
                break
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=15.0)
            if msg is not None:
                await websocket.send_text(str(msg["data"]))
            else:
                await websocket.send_json({"event": "ping"})  # keeps proxies from idling out
    except (WebSocketDisconnect, RedisError, RuntimeError):
        pass
    finally:
        with contextlib.suppress(Exception):
            await pubsub.unsubscribe()
            await pubsub.aclose()  # type: ignore[no-untyped-call]
