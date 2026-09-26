"""FastAPI dependencies for authentication and authorization.

Usage in routers:

    @router.get("/things")
    async def list_things(principal: CurrentPrincipal): ...

    @router.post("/things", dependencies=[Depends(require_permission(P.THINGS_WRITE))])

Authorization is always enforced here or in services — never only in the frontend.
"""

from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rate_limit import enforce_rate_limit
from app.core.security import InvalidTokenError, TokenClaims, TokenType, decode_jwt
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import DevicePrincipal, Principal
from app.modules.companies.models import Company
from app.modules.devices.models import Device, DeviceStatus
from app.modules.users.models import User
from app.modules.users.permissions import P
from app.modules.users.repository import load_permission_scopes
from app.shared.exceptions import AuthenticationError

_bearer = HTTPBearer(auto_error=False)
USER_REQUESTS_PER_MINUTE = 600
DEVICE_REQUESTS_PER_MINUTE = 600

DbSession = Annotated[AsyncSession, Depends(get_db)]


def _claims(credentials: HTTPAuthorizationCredentials | None, expected: TokenType) -> TokenClaims:
    if credentials is None:
        raise AuthenticationError("Not authenticated", code="auth.missing_token")
    try:
        claims = decode_jwt(credentials.credentials)
    except InvalidTokenError as exc:
        raise AuthenticationError("Invalid or expired token", code="auth.invalid_token") from exc
    if claims.token_type != expected:
        raise AuthenticationError("Wrong token type", code="auth.invalid_token")
    return claims


async def _active_device(db: AsyncSession, claims: TokenClaims) -> Device:
    device_id = claims.device_id if claims.token_type == TokenType.ACCESS else claims.subject
    device = await db.get(Device, device_id)
    if device is None or device.company_id != claims.company_id:
        raise AuthenticationError("Unknown device", code="auth.device_unknown")
    if device.status != DeviceStatus.ACTIVE:
        raise AuthenticationError("Device has been revoked", code="auth.device_revoked")
    return device


async def get_current_principal(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> Principal:
    claims = _claims(credentials, TokenType.ACCESS)
    row = (
        await db.execute(
            select(User, Company.is_active)
            .join(Company, Company.id == User.company_id)
            .where(User.id == claims.subject)
        )
    ).one_or_none()
    if row is None:
        raise AuthenticationError("User not found", code="auth.invalid_token")
    user, company_active = row
    if not user.is_active or not company_active or user.company_id != claims.company_id:
        raise AuthenticationError("Account is disabled", code="auth.account_disabled")
    if claims.device_id is not None:
        await _active_device(db, claims)

    # Generous ceiling against runaway clients and scripted abuse; normal use never gets near it.
    await enforce_rate_limit(
        f"api:user:{user.id}", limit=USER_REQUESTS_PER_MINUTE, window_seconds=60
    )
    global_perms, branch_perms = await load_permission_scopes(db, user.id)
    return Principal(
        user_id=user.id,
        company_id=user.company_id,
        username=user.username,
        device_id=claims.device_id,
        global_permissions=global_perms,
        branch_permissions=branch_perms,
    )


async def get_current_device(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> DevicePrincipal:
    claims = _claims(credentials, TokenType.DEVICE)
    device = await _active_device(db, claims)
    await enforce_rate_limit(
        f"api:device:{device.id}", limit=DEVICE_REQUESTS_PER_MINUTE, window_seconds=60
    )
    return DevicePrincipal(
        device_id=device.id,
        company_id=device.company_id,
        branch_id=device.branch_id,
        terminal_code=device.terminal_code,
    )


CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]
CurrentDevice = Annotated[DevicePrincipal, Depends(get_current_device)]


def require_permission(permission: P):  # type: ignore[no-untyped-def]
    """Dependency factory: the user must hold `permission` in at least one scope.

    Branch-specific checks (e.g. "void a sale *in this branch*") happen in the service with
    `principal.require(permission, branch_id)`, because the branch is only known there.
    """

    async def dependency(principal: CurrentPrincipal) -> Principal:
        if not principal.has_in_any_scope(permission):
            principal.require(permission)  # raises with a consistent error body
        return principal

    return dependency


def require_any_permission(*permissions: P):  # type: ignore[no-untyped-def]
    """Dependency factory: the user must hold at least one of `permissions` (any scope)."""

    async def dependency(principal: CurrentPrincipal) -> Principal:
        if not any(principal.has_in_any_scope(p) for p in permissions):
            principal.require(permissions[0])  # raises with a consistent error body
        return principal

    return dependency


def client_ip(request: Request) -> str | None:
    # Behind Nginx, uvicorn's --proxy-headers sets request.client from X-Forwarded-For.
    return request.client.host if request.client else None


def audit_actor(principal: Principal, request: Request) -> AuditActor:
    return AuditActor(
        company_id=principal.company_id,
        user_id=principal.user_id,
        device_id=principal.device_id,
        ip_address=client_ip(request),
    )
