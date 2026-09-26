import uuid
from enum import StrEnum

from pydantic import EmailStr, Field

from app.modules.companies.schemas import Password
from app.modules.users.schemas import Pin
from app.shared.schemas import ResponseSchema, Schema


class AuthClient(StrEnum):
    ADMIN = "admin"
    POS = "pos"


class LoginRequest(Schema):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class PinLoginRequest(Schema):
    username: str = Field(min_length=1, max_length=64)
    pin: Pin


class RefreshRequest(Schema):
    client: AuthClient = AuthClient.ADMIN


class CompanySummary(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    currency: str
    timezone: str
    prices_include_tax: bool


class MeResponse(ResponseSchema):
    id: uuid.UUID
    email: str
    username: str
    full_name: str
    has_pin: bool
    company: CompanySummary
    device_id: uuid.UUID | None
    permissions: list[str]
    branch_permissions: dict[uuid.UUID, list[str]]


class TokenResponse(ResponseSchema):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: MeResponse


class ChangePasswordRequest(Schema):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: Password


class SetOwnPinRequest(Schema):
    current_password: str = Field(min_length=1, max_length=128)
    pin: Pin
