"""Authentication endpoints.

Access tokens are returned in the JSON body (the browser keeps them in memory). Refresh tokens
are only ever sent as httpOnly cookies, scoped to this router's path.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Cookie, Header, Request, Response, status

from app.core.config import get_settings
from app.core.rate_limit import enforce_rate_limit
from app.modules.auth import service
from app.modules.auth.dependencies import CurrentDevice, CurrentPrincipal, DbSession, client_ip
from app.modules.auth.principal import Principal
from app.modules.auth.schemas import (
    AuthClient,
    ChangePasswordRequest,
    CompanySummary,
    LoginRequest,
    MeResponse,
    PinLoginRequest,
    RefreshRequest,
    SetOwnPinRequest,
    TokenResponse,
)
from app.modules.companies.models import Company
from app.modules.users.models import User
from app.modules.users.repository import load_permission_scopes
from app.shared.exceptions import AuthenticationError, NotFoundError

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAMES = {AuthClient.ADMIN: "rt_admin", AuthClient.POS: "rt_pos"}
CSRF_HEADER_VALUE = "pos"


def _cookie_path() -> str:
    return f"{get_settings().api_prefix}/auth"


def _set_refresh_cookie(response: Response, client: AuthClient, token: str, max_age: int) -> None:
    response.set_cookie(
        COOKIE_NAMES[client],
        token,
        max_age=max_age,
        path=_cookie_path(),
        httponly=True,
        secure=get_settings().cookie_secure,
        samesite="strict",
    )


def _require_csrf_header(x_requested_with: str | None) -> None:
    # Cookie-authenticated endpoints require a custom header, which cross-site forms cannot send.
    if x_requested_with != CSRF_HEADER_VALUE:
        raise AuthenticationError("Missing X-Requested-With header", code="auth.csrf")


def _info(request: Request) -> service.ClientInfo:
    return service.ClientInfo(ip=client_ip(request), user_agent=request.headers.get("user-agent"))


async def build_me(db: DbSession, user: User, device_id: uuid.UUID | None = None) -> MeResponse:
    company = await db.get(Company, user.company_id)
    if company is None:
        raise NotFoundError("Company not found")
    global_perms, branch_perms = await load_permission_scopes(db, user.id)
    return MeResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        full_name=user.full_name,
        has_pin=user.pin_hash is not None,
        company=CompanySummary.model_validate(company),
        device_id=device_id,
        permissions=sorted(global_perms),
        branch_permissions={b: sorted(p) for b, p in branch_perms.items()},
    )


async def _token_response(
    db: DbSession, response: Response, session: service.IssuedSession, client: AuthClient
) -> TokenResponse:
    _set_refresh_cookie(response, client, session.refresh_token, session.refresh_expires_in)
    return TokenResponse(
        access_token=session.access_token,
        expires_in=session.access_expires_in,
        user=await build_me(db, session.user, session.device_id),
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    data: LoginRequest, request: Request, response: Response, db: DbSession
) -> TokenResponse:
    """Admin portal login with email and password."""
    ip = client_ip(request)
    await enforce_rate_limit(f"login:ip:{ip}", limit=10, window_seconds=60)
    await enforce_rate_limit(f"login:email:{data.email.lower()}", limit=5, window_seconds=60)
    session = await service.login(db, data.email, data.password, _info(request))
    return await _token_response(db, response, session, AuthClient.ADMIN)


@router.post("/pin-login", response_model=TokenResponse)
async def pin_login(
    data: PinLoginRequest,
    device: CurrentDevice,
    request: Request,
    response: Response,
    db: DbSession,
) -> TokenResponse:
    """Cashier login on a registered POS terminal. Requires a device token."""
    await enforce_rate_limit(f"pin:device:{device.device_id}", limit=10, window_seconds=60)
    session = await service.pin_login(db, device, data.username, data.pin, _info(request))
    return await _token_response(db, response, session, AuthClient.POS)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(
    request: Request,
    response: Response,
    db: DbSession,
    body: RefreshRequest | None = None,
    x_requested_with: Annotated[str | None, Header()] = None,
    rt_admin: Annotated[str | None, Cookie()] = None,
    rt_pos: Annotated[str | None, Cookie()] = None,
) -> TokenResponse:
    _require_csrf_header(x_requested_with)
    client = body.client if body else AuthClient.ADMIN
    token = rt_pos if client == AuthClient.POS else rt_admin
    if not token:
        raise AuthenticationError("No session", code="auth.no_session")
    session = await service.refresh(db, token, client, _info(request))
    return await _token_response(db, response, session, client)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    db: DbSession,
    body: RefreshRequest | None = None,
    x_requested_with: Annotated[str | None, Header()] = None,
    rt_admin: Annotated[str | None, Cookie()] = None,
    rt_pos: Annotated[str | None, Cookie()] = None,
) -> None:
    _require_csrf_header(x_requested_with)
    client = body.client if body else AuthClient.ADMIN
    await service.logout(db, rt_pos if client == AuthClient.POS else rt_admin)
    response.delete_cookie(COOKIE_NAMES[client], path=_cookie_path())


@router.get("/me", response_model=MeResponse)
async def me(principal: CurrentPrincipal, db: DbSession) -> MeResponse:
    user = await db.get(User, principal.user_id)
    if user is None:
        raise NotFoundError("User not found")
    return await build_me(db, user, principal.device_id)


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    data: ChangePasswordRequest, principal: CurrentPrincipal, request: Request, db: DbSession
) -> None:
    await _limit_sensitive(principal)
    await service.change_password(
        db, principal, data.current_password, data.new_password, _info(request)
    )


@router.put("/me/pin", status_code=status.HTTP_204_NO_CONTENT)
async def set_own_pin(
    data: SetOwnPinRequest, principal: CurrentPrincipal, request: Request, db: DbSession
) -> None:
    await _limit_sensitive(principal)
    await service.set_own_pin(db, principal, data.current_password, data.pin, _info(request))


async def _limit_sensitive(principal: Principal) -> None:
    await enforce_rate_limit(f"sensitive:{principal.user_id}", limit=5, window_seconds=300)
