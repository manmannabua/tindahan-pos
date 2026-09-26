"""POS terminal registration and authentication. See docs/DEVICE_MANAGEMENT.md."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.redis import get_redis
from app.core.security import (
    InvalidPublicKeyError,
    TokenType,
    create_jwt,
    device_challenge_message,
    generate_opaque_token,
    load_device_public_key,
    public_key_to_pem,
    verify_device_signature,
)
from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.branches.models import Branch
from app.modules.devices.models import Device, DeviceStatus
from app.modules.devices.schemas import DeviceRegisterRequest
from app.modules.users.permissions import P
from app.shared.exceptions import (
    AuthenticationError,
    BusinessRuleError,
    ConflictError,
    NotFoundError,
)


def _challenge_key(device_id: uuid.UUID, nonce: str) -> str:
    return f"devchal:{device_id}:{nonce}"


async def register_device(
    db: AsyncSession, principal: Principal, data: DeviceRegisterRequest, actor: AuditActor
) -> Device:
    principal.require(P.DEVICES_REGISTER, data.branch_id)
    branch = await db.scalar(
        select(Branch).where(Branch.company_id == principal.company_id, Branch.id == data.branch_id)
    )
    if branch is None:
        raise NotFoundError("Branch not found", code="branch.not_found")
    if not branch.is_active:
        raise BusinessRuleError("Branch is inactive", code="branch.inactive")
    try:
        public_key = load_device_public_key(data.public_key)
    except InvalidPublicKeyError as exc:
        raise BusinessRuleError(str(exc), code="device.invalid_public_key") from exc

    taken = await db.scalar(
        select(Device.id).where(
            Device.branch_id == branch.id,
            Device.terminal_code == data.terminal_code,
            Device.status != DeviceStatus.REVOKED,
        )
    )
    if taken:
        raise ConflictError(
            "Terminal code is already used by an active device in this branch",
            code="device.terminal_code_taken",
        )

    device = Device(
        company_id=principal.company_id,
        branch_id=branch.id,
        terminal_code=data.terminal_code,
        name=data.name,
        platform=data.platform,
        app_version=data.app_version,
        public_key=public_key_to_pem(public_key),
        status=DeviceStatus.ACTIVE,
        registered_by_id=principal.user_id,
        registered_at=datetime.now(UTC),
    )
    db.add(device)
    await db.flush()
    audit.record(
        db,
        actor,
        "device.registered",
        entity_type="device",
        entity_id=device.id,
        branch_id=branch.id,
        metadata={"terminal_code": device.terminal_code, "name": device.name},
    )
    await db.commit()
    return device


async def list_devices(
    db: AsyncSession, principal: Principal, *, branch_id: uuid.UUID | None
) -> list[Device]:
    stmt = select(Device).where(Device.company_id == principal.company_id)
    scope = principal.branch_scope(P.DEVICES_MANAGE)
    if scope is not None:
        stmt = stmt.where(Device.branch_id.in_(scope))
    if branch_id is not None:
        stmt = stmt.where(Device.branch_id == branch_id)
    return list(await db.scalars(stmt.order_by(Device.branch_id, Device.terminal_code)))


async def get_device(db: AsyncSession, company_id: uuid.UUID, device_id: uuid.UUID) -> Device:
    device = await db.scalar(
        select(Device).where(Device.company_id == company_id, Device.id == device_id)
    )
    if device is None:
        raise NotFoundError("Device not found", code="device.not_found")
    return device


async def revoke_device(
    db: AsyncSession, principal: Principal, device_id: uuid.UUID, actor: AuditActor
) -> Device:
    device = await get_device(db, principal.company_id, device_id)
    principal.require(P.DEVICES_MANAGE, device.branch_id)
    if device.status == DeviceStatus.REVOKED:
        return device
    device.status = DeviceStatus.REVOKED
    device.revoked_at = datetime.now(UTC)
    device.revoked_by_id = principal.user_id
    audit.record(
        db,
        actor,
        "device.revoked",
        entity_type="device",
        entity_id=device.id,
        branch_id=device.branch_id,
        metadata={
            "terminal_code": device.terminal_code,
            "pending_operations": device.pending_operations,
            "last_sync_at": device.last_sync_at.isoformat() if device.last_sync_at else None,
        },
    )
    await db.commit()
    return device


async def issue_challenge(db: AsyncSession, device_id: uuid.UUID) -> tuple[str, int]:
    device = await db.get(Device, device_id)
    if device is None or device.status != DeviceStatus.ACTIVE:
        raise NotFoundError("Device not found", code="device.not_found")
    ttl = get_settings().device_challenge_ttl_seconds
    nonce = generate_opaque_token(24)
    await get_redis().set(_challenge_key(device_id, nonce), "1", ex=ttl)
    return nonce, ttl


async def issue_device_token(
    db: AsyncSession, device_id: uuid.UUID, nonce: str, signature: str
) -> tuple[Device, str, int]:
    # GETDEL makes the nonce single-use even under concurrent requests.
    if await get_redis().getdel(_challenge_key(device_id, nonce)) is None:
        raise AuthenticationError("Challenge expired or unknown", code="device.challenge_invalid")
    device = await db.get(Device, device_id)
    if device is None or device.status != DeviceStatus.ACTIVE:
        raise AuthenticationError("Device is not active", code="auth.device_revoked")
    if not verify_device_signature(
        device.public_key, device_challenge_message(device_id, nonce), signature
    ):
        raise AuthenticationError("Invalid device signature", code="device.bad_signature")

    ttl = get_settings().device_token_ttl_seconds
    token, _ = create_jwt(
        subject=device.id,
        company_id=device.company_id,
        token_type=TokenType.DEVICE,
        ttl_seconds=ttl,
    )
    device.last_seen_at = datetime.now(UTC)
    await db.commit()
    return device, token, ttl
