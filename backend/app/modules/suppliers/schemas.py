import uuid
from datetime import datetime
from typing import Annotated

from pydantic import EmailStr, Field, StringConstraints

from app.shared.schemas import ResponseSchema, Schema

SupplierCode = Annotated[
    str, StringConstraints(min_length=1, max_length=32, pattern=r"^[A-Z0-9][A-Z0-9_-]*$")
]


class SupplierRead(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    contact_person: str | None
    phone: str | None
    email: str | None
    address: str | None
    tin: str | None
    payment_terms_days: int
    notes: str | None
    is_active: bool
    created_at: datetime


class SupplierCreate(Schema):
    code: SupplierCode
    name: str = Field(min_length=1, max_length=200)
    contact_person: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=500)
    tin: str | None = Field(default=None, max_length=32)
    payment_terms_days: int = Field(default=0, ge=0, le=365)
    notes: str | None = Field(default=None, max_length=5000)


class SupplierUpdate(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    contact_person: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=500)
    tin: str | None = Field(default=None, max_length=32)
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    notes: str | None = Field(default=None, max_length=5000)
    is_active: bool | None = None
