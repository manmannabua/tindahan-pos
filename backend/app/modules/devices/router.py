import uuid

from fastapi import APIRouter, Depends, Request, status

from app.core.rate_limit import enforce_rate_limit
from app.modules.auth.dependencies import (
    CurrentDevice,
    CurrentPrincipal,
    DbSession,
    audit_actor,
    client_ip,
    require_permission,
)
from app.modules.devices import service
from app.modules.devices.schemas import (
    DeviceChallengeResponse,
    DeviceRead,
    DeviceRegisterRequest,
    DeviceTokenRequest,
    DeviceTokenResponse,
    DeviceUpdate,
)
from app.modules.users.permissions import P

router = APIRouter(prefix="/devices", tags=["devices"])


@router.post(
    "/register",
    response_model=DeviceRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(P.DEVICES_REGISTER))],
)
async def register_device(
    data: DeviceRegisterRequest, principal: CurrentPrincipal, request: Request, db: DbSession
) -> DeviceRead:
    device = await service.register_device(db, principal, data, audit_actor(principal, request))
    return DeviceRead.model_validate(device)


@router.get(
    "",
    response_model=list[DeviceRead],
    dependencies=[Depends(require_permission(P.DEVICES_MANAGE))],
)
async def list_devices(
    principal: CurrentPrincipal, db: DbSession, branch_id: uuid.UUID | None = None
) -> list[DeviceRead]:
    devices = await service.list_devices(db, principal, branch_id=branch_id)
    return [DeviceRead.model_validate(d) for d in devices]


@router.get("/me", response_model=DeviceRead)
async def current_device(device: CurrentDevice, db: DbSession) -> DeviceRead:
    """The calling terminal (device token)."""
    return DeviceRead.model_validate(
        await service.get_device(db, device.company_id, device.device_id)
    )


@router.get(
    "/{device_id}",
    response_model=DeviceRead,
    dependencies=[Depends(require_permission(P.DEVICES_MANAGE))],
)
async def get_device(
    device_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> DeviceRead:
    return DeviceRead.model_validate(await service.get_device(db, principal.company_id, device_id))


@router.patch(
    "/{device_id}",
    response_model=DeviceRead,
    dependencies=[Depends(require_permission(P.DEVICES_MANAGE))],
)
async def update_device(
    device_id: uuid.UUID,
    data: DeviceUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> DeviceRead:
    """Rename a terminal or record its BIR registration (MIN, serial number, PTU)."""
    device = await service.update_device(
        db, principal, device_id, data, audit_actor(principal, request)
    )
    return DeviceRead.model_validate(device)


@router.post(
    "/{device_id}/revoke",
    response_model=DeviceRead,
    dependencies=[Depends(require_permission(P.DEVICES_MANAGE))],
)
async def revoke_device(
    device_id: uuid.UUID, principal: CurrentPrincipal, request: Request, db: DbSession
) -> DeviceRead:
    device = await service.revoke_device(db, principal, device_id, audit_actor(principal, request))
    return DeviceRead.model_validate(device)


@router.post("/{device_id}/challenge", response_model=DeviceChallengeResponse)
async def device_challenge(
    device_id: uuid.UUID, request: Request, db: DbSession
) -> DeviceChallengeResponse:
    """Step 1 of device authentication: get a single-use nonce to sign."""
    await enforce_rate_limit(f"devchal:{device_id}", limit=20, window_seconds=60)
    await enforce_rate_limit(f"devchal:ip:{client_ip(request)}", limit=60, window_seconds=60)
    nonce, ttl = await service.issue_challenge(db, device_id)
    return DeviceChallengeResponse(nonce=nonce, expires_in=ttl)


@router.post("/token", response_model=DeviceTokenResponse)
async def device_token(data: DeviceTokenRequest, db: DbSession) -> DeviceTokenResponse:
    """Step 2: exchange the signed nonce for a short-lived device token."""
    device, token, ttl = await service.issue_device_token(
        db, data.device_id, data.nonce, data.signature
    )
    return DeviceTokenResponse(
        access_token=token, expires_in=ttl, device=DeviceRead.model_validate(device)
    )
