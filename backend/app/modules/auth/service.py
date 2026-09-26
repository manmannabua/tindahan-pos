"""Authentication flows. See docs/SECURITY.md."""

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import (
    TokenType,
    create_jwt,
    generate_opaque_token,
    hash_opaque_token,
    hash_secret,
    needs_rehash,
    verify_secret,
)
from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.models import RefreshToken
from app.modules.auth.principal import DevicePrincipal, Principal
from app.modules.auth.schemas import AuthClient
from app.modules.companies.models import Company
from app.modules.users.models import User
from app.modules.users.permissions import P
from app.modules.users.repository import (
    get_user_by_email,
    get_user_by_username,
    load_permission_scopes,
)
from app.modules.users.service import set_pin_credentials
from app.shared.exceptions import AuthenticationError, PermissionDeniedError

# A token rotated less than this long ago is treated as a benign race (two tabs refreshing at
# once), not as theft. The request is refused, but the token family is not revoked.
_ROTATION_GRACE = timedelta(seconds=15)


@dataclass(frozen=True, slots=True)
class IssuedSession:
    user: User
    access_token: str
    access_expires_in: int
    refresh_token: str
    refresh_expires_in: int
    device_id: uuid.UUID | None = None


@dataclass(frozen=True, slots=True)
class ClientInfo:
    ip: str | None
    user_agent: str | None


def _refresh_ttl(client: AuthClient) -> int:
    s = get_settings()
    return (
        s.refresh_token_ttl_pos_seconds
        if client == AuthClient.POS
        else s.refresh_token_ttl_admin_seconds
    )


async def _issue_session(
    db: AsyncSession,
    user: User,
    client: AuthClient,
    info: ClientInfo,
    *,
    device_id: uuid.UUID | None = None,
    family_id: uuid.UUID | None = None,
) -> tuple[IssuedSession, RefreshToken]:
    settings = get_settings()
    access_token, _ = create_jwt(
        subject=user.id,
        company_id=user.company_id,
        token_type=TokenType.ACCESS,
        ttl_seconds=settings.access_token_ttl_seconds,
        device_id=device_id,
    )
    refresh_plain = generate_opaque_token()
    ttl = _refresh_ttl(client)
    token_row = RefreshToken(
        user_id=user.id,
        family_id=family_id or uuid.uuid4(),
        token_hash=hash_opaque_token(refresh_plain),
        client=client.value,
        device_id=device_id,
        expires_at=datetime.now(UTC) + timedelta(seconds=ttl),
        created_ip=info.ip,
        user_agent=(info.user_agent or "")[:500] or None,
    )
    db.add(token_row)
    session = IssuedSession(
        user=user,
        access_token=access_token,
        access_expires_in=settings.access_token_ttl_seconds,
        refresh_token=refresh_plain,
        refresh_expires_in=ttl,
        device_id=device_id,
    )
    return session, token_row


async def _company_active(db: AsyncSession, company_id: uuid.UUID) -> bool:
    return bool(await db.scalar(select(Company.is_active).where(Company.id == company_id)))


async def login(db: AsyncSession, email: str, password: str, info: ClientInfo) -> IssuedSession:
    user = await get_user_by_email(db, email)
    valid = verify_secret(password, user.password_hash if user else None)
    if user is None or not valid:
        audit.record(
            db,
            AuditActor(
                company_id=user.company_id if user else None,
                user_id=user.id if user else None,
                ip_address=info.ip,
            ),
            "auth.login_failed",
            metadata={"email": email.lower()},
        )
        await db.commit()
        raise AuthenticationError("Invalid email or password", code="auth.invalid_credentials")
    if not user.is_active or not await _company_active(db, user.company_id):
        raise AuthenticationError("Account is disabled", code="auth.account_disabled")

    if needs_rehash(user.password_hash):
        user.password_hash = hash_secret(password)
    user.last_login_at = datetime.now(UTC)
    session, _ = await _issue_session(db, user, AuthClient.ADMIN, info)
    audit.record(
        db,
        AuditActor(company_id=user.company_id, user_id=user.id, ip_address=info.ip),
        "auth.login",
        entity_type="user",
        entity_id=user.id,
    )
    await db.commit()
    return session


async def pin_login(
    db: AsyncSession, device: DevicePrincipal, username: str, pin: str, info: ClientInfo
) -> IssuedSession:
    """Cashier login on a registered terminal (online path). Offline login is local."""
    user = await get_user_by_username(db, device.company_id, username.lower())
    valid = verify_secret(pin, user.pin_hash if user else None)
    actor = AuditActor(
        company_id=device.company_id,
        user_id=user.id if user else None,
        device_id=device.device_id,
        ip_address=info.ip,
    )
    if user is None or not valid or not user.is_active:
        audit.record(db, actor, "auth.pin_login_failed", metadata={"username": username})
        await db.commit()
        raise AuthenticationError("Invalid username or PIN", code="auth.invalid_credentials")

    global_perms, branch_perms = await load_permission_scopes(db, user.id)
    principal = Principal(
        user_id=user.id,
        company_id=user.company_id,
        username=user.username,
        global_permissions=global_perms,
        branch_permissions=branch_perms,
    )
    if not principal.has(P.POS_ACCESS, device.branch_id):
        raise PermissionDeniedError(
            "You are not allowed to use POS terminals in this branch", code="auth.no_pos_access"
        )

    user.last_login_at = datetime.now(UTC)
    session, _ = await _issue_session(db, user, AuthClient.POS, info, device_id=device.device_id)
    audit.record(
        db,
        actor,
        "auth.pin_login",
        entity_type="user",
        entity_id=user.id,
        branch_id=device.branch_id,
    )
    await db.commit()
    return session


async def refresh(
    db: AsyncSession, refresh_plain: str, client: AuthClient, info: ClientInfo
) -> IssuedSession:
    now = datetime.now(UTC)
    token = await db.scalar(
        select(RefreshToken)
        .where(RefreshToken.token_hash == hash_opaque_token(refresh_plain))
        .with_for_update()  # serialize concurrent refreshes of the same token
    )
    if token is None or token.client != client.value:
        raise AuthenticationError("Invalid refresh token", code="auth.invalid_refresh")

    if token.revoked_at is not None:
        if token.replaced_by_id is not None and now - token.revoked_at < _ROTATION_GRACE:
            raise AuthenticationError("Refresh token already rotated", code="auth.refresh_race")
        # Reuse of a rotated token: assume theft, revoke every token in the family.
        await _revoke_family(db, token.family_id, now)
        user = await db.get(User, token.user_id)
        audit.record(
            db,
            AuditActor(
                company_id=user.company_id if user else None,
                user_id=token.user_id,
                ip_address=info.ip,
            ),
            "auth.refresh_reuse_detected",
            metadata={"family_id": str(token.family_id)},
        )
        await db.commit()
        raise AuthenticationError("Session revoked", code="auth.refresh_reused")

    if token.expires_at <= now:
        raise AuthenticationError("Session expired", code="auth.refresh_expired")

    user = await db.get(User, token.user_id)
    if user is None or not user.is_active or not await _company_active(db, user.company_id):
        raise AuthenticationError("Account is disabled", code="auth.account_disabled")

    session, new_row = await _issue_session(
        db, user, client, info, device_id=token.device_id, family_id=token.family_id
    )
    await db.flush()
    token.revoked_at = now
    token.replaced_by_id = new_row.id
    await db.commit()
    return session


async def logout(db: AsyncSession, refresh_plain: str | None) -> None:
    if not refresh_plain:
        return
    token = await db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_opaque_token(refresh_plain))
    )
    if token is not None:
        await _revoke_family(db, token.family_id, datetime.now(UTC))
        await db.commit()


async def _revoke_family(db: AsyncSession, family_id: uuid.UUID, now: datetime) -> None:
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.family_id == family_id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=now)
    )


async def change_password(
    db: AsyncSession, principal: Principal, current: str, new: str, info: ClientInfo
) -> None:
    user = await db.get(User, principal.user_id)
    if user is None or not verify_secret(current, user.password_hash):
        raise AuthenticationError("Current password is incorrect", code="auth.invalid_credentials")
    user.password_hash = hash_secret(new)
    # Other sessions are signed out; the current access token expires naturally.
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.user_id == user.id, RefreshToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(UTC))
    )
    audit.record(
        db,
        AuditActor(company_id=user.company_id, user_id=user.id, ip_address=info.ip),
        "auth.password_changed",
        entity_type="user",
        entity_id=user.id,
    )
    await db.commit()


async def set_own_pin(
    db: AsyncSession, principal: Principal, current_password: str, pin: str, info: ClientInfo
) -> None:
    user = await db.get(User, principal.user_id)
    if user is None or not verify_secret(current_password, user.password_hash):
        raise AuthenticationError("Current password is incorrect", code="auth.invalid_credentials")
    set_pin_credentials(user, pin)
    audit.record(
        db,
        AuditActor(company_id=user.company_id, user_id=user.id, ip_address=info.ip),
        "user.pin_changed",
        entity_type="user",
        entity_id=user.id,
    )
    await db.commit()
