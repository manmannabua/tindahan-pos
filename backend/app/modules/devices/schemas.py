import uuid
from datetime import date, datetime

from pydantic import Field

from app.modules.companies.schemas import Code
from app.modules.devices.models import DeviceStatus
from app.shared.schemas import ResponseSchema, Schema


class DeviceRegisterRequest(Schema):
    branch_id: uuid.UUID
    terminal_code: Code
    name: str = Field(min_length=2, max_length=100)
    platform: str | None = Field(default=None, max_length=200)
    app_version: str | None = Field(default=None, max_length=32)
    public_key: str = Field(
        min_length=40, max_length=500, description="Base64 SPKI of an ECDSA P-256 public key"
    )


class DeviceRead(ResponseSchema):
    id: uuid.UUID
    branch_id: uuid.UUID
    terminal_code: str
    name: str
    platform: str | None
    app_version: str | None
    status: DeviceStatus
    registered_at: datetime
    registered_by_id: uuid.UUID
    revoked_at: datetime | None
    last_seen_at: datetime | None
    last_sync_at: datetime | None
    pending_operations: int | None
    bir_min: str | None
    bir_serial_number: str | None
    bir_ptu_number: str | None
    bir_ptu_issued_on: date | None


class DeviceUpdate(Schema):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    bir_min: str | None = Field(default=None, max_length=32)
    bir_serial_number: str | None = Field(default=None, max_length=64)
    bir_ptu_number: str | None = Field(default=None, max_length=64)
    bir_ptu_issued_on: date | None = None


class DeviceChallengeResponse(ResponseSchema):
    nonce: str
    expires_in: int


class DeviceTokenRequest(Schema):
    device_id: uuid.UUID
    nonce: str = Field(min_length=16, max_length=128)
    signature: str = Field(min_length=40, max_length=200, description="Base64 ECDSA signature")


class DeviceTokenResponse(ResponseSchema):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    device: DeviceRead
