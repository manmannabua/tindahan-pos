"""HTTP middleware: request ids and security headers.

Written as pure ASGI middleware (not BaseHTTPMiddleware) so it doesn't buffer responses or
break WebSockets.
"""

import secrets

import structlog
from starlette.types import ASGIApp, Message, Receive, Scope, Send

SECURITY_HEADERS: list[tuple[bytes, bytes]] = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"cross-origin-opener-policy", b"same-origin"),
    (b"permissions-policy", b"camera=(self), microphone=(), geolocation=()"),
    # API responses are JSON; a strict CSP prevents them being rendered as a document.
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
]


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp, *, hsts: bool = False) -> None:
        self.app = app
        self.hsts = hsts

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = dict(scope["headers"]).get(b"x-request-id", b"").decode()[:64]
        request_id = incoming or secrets.token_hex(8)
        structlog.contextvars.clear_contextvars()
        structlog.contextvars.bind_contextvars(request_id=request_id)

        is_docs = scope["path"].endswith(("/docs", "/redoc", "/openapi.json"))

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = list(message.get("headers", []))
                headers.append((b"x-request-id", request_id.encode()))
                for name, value in SECURITY_HEADERS:
                    if is_docs and name == b"content-security-policy":
                        continue  # Swagger UI needs inline scripts
                    headers.append((name, value))
                if self.hsts:
                    headers.append(
                        (b"strict-transport-security", b"max-age=63072000; includeSubDomains")
                    )
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_headers)
