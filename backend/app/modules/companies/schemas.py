import uuid
from typing import Annotated, Any

from pydantic import EmailStr, Field, StringConstraints

from app.shared.schemas import ResponseSchema, Schema

Code = Annotated[
    str, StringConstraints(min_length=2, max_length=16, pattern=r"^[A-Z0-9][A-Z0-9_-]*$")
]
Password = Annotated[str, StringConstraints(min_length=10, max_length=128)]
Username = Annotated[
    str, StringConstraints(min_length=2, max_length=64, pattern=r"^[a-z0-9][a-z0-9._-]*$")
]


class SignupRequest(Schema):
    company_name: str = Field(min_length=2, max_length=200)
    company_code: Annotated[
        str, StringConstraints(min_length=2, max_length=32, pattern=r"^[A-Z0-9][A-Z0-9_-]*$")
    ]
    branch_name: str = Field(default="Main Branch", min_length=2, max_length=200)
    branch_code: Code = "MAIN"
    owner_full_name: str = Field(min_length=2, max_length=200)
    owner_email: EmailStr
    owner_username: Username
    owner_password: Password
    timezone: str = "Asia/Manila"
    currency: str = Field(default="PHP", min_length=3, max_length=3)


class CompanyRead(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    legal_name: str | None
    tin: str | None
    currency: str
    timezone: str
    prices_include_tax: bool
    vat_registered: bool
    bir_accreditation_no: str | None
    settings: dict[str, Any]
    is_active: bool


class CompanyUpdate(Schema):
    name: str | None = Field(default=None, min_length=2, max_length=200)
    legal_name: str | None = Field(default=None, max_length=200)
    tin: str | None = Field(default=None, max_length=32)
    timezone: str | None = Field(default=None, max_length=64)
    prices_include_tax: bool | None = None
    vat_registered: bool | None = None
    bir_accreditation_no: str | None = Field(default=None, max_length=64)
    settings: dict[str, Any] | None = None


class SignupResponse(ResponseSchema):
    company: CompanyRead
    owner_user_id: uuid.UUID
    branch_id: uuid.UUID
