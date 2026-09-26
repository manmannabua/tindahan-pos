import uuid
from datetime import datetime
from typing import Annotated

from pydantic import EmailStr, Field, StringConstraints, field_validator

from app.modules.companies.schemas import Password, Username
from app.modules.users.permissions import P
from app.shared.schemas import ResponseSchema, Schema

Pin = Annotated[str, StringConstraints(min_length=4, max_length=8, pattern=r"^\d+$")]
RoleCode = Annotated[
    str, StringConstraints(min_length=2, max_length=32, pattern=r"^[A-Z][A-Z0-9_]*$")
]


class RoleAssignment(Schema):
    role_id: uuid.UUID
    branch_id: uuid.UUID | None = None


class RoleAssignmentRead(ResponseSchema):
    role_id: uuid.UUID
    role_code: str
    role_name: str
    branch_id: uuid.UUID | None


class UserRead(ResponseSchema):
    id: uuid.UUID
    email: str
    username: str
    full_name: str
    is_active: bool
    has_pin: bool
    last_login_at: datetime | None
    created_at: datetime
    roles: list[RoleAssignmentRead]


class UserCreate(Schema):
    email: EmailStr
    username: Username
    full_name: str = Field(min_length=2, max_length=200)
    password: Password
    pin: Pin | None = None
    roles: list[RoleAssignment] = Field(min_length=1)


class UserUpdate(Schema):
    email: EmailStr | None = None
    full_name: str | None = Field(default=None, min_length=2, max_length=200)
    is_active: bool | None = None


class SetRolesRequest(Schema):
    roles: list[RoleAssignment] = Field(min_length=1)


class SetPinRequest(Schema):
    pin: Pin


class ResetPasswordRequest(Schema):
    password: Password


class RoleRead(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    description: str | None
    is_system: bool
    permissions: list[str]


class RoleCreate(Schema):
    code: RoleCode
    name: str = Field(min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    permissions: list[P]

    @field_validator("permissions")
    @classmethod
    def _unique(cls, value: list[P]) -> list[P]:
        return sorted(set(value))


class RoleUpdate(Schema):
    name: str | None = Field(default=None, min_length=2, max_length=100)
    description: str | None = Field(default=None, max_length=500)
    permissions: list[P] | None = None


class PermissionRead(ResponseSchema):
    code: str
    description: str
