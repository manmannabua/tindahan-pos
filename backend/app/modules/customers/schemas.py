import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from pydantic import EmailStr, Field

from app.shared.schemas import ResponseSchema, Schema

MoneyIn = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]


class CustomerRead(ResponseSchema):
    id: uuid.UUID
    code: str | None
    name: str
    phone: str | None
    email: str | None
    address: str | None
    tin: str | None
    price_level_id: uuid.UUID | None
    credit_limit: Decimal | None
    notes: str | None
    is_active: bool
    created_at: datetime


class CustomerCreate(Schema):
    id: uuid.UUID | None = Field(default=None, description="Client-generated id (optional)")
    code: str | None = Field(default=None, max_length=32)
    name: str = Field(min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=500)
    tin: str | None = Field(default=None, max_length=32)
    price_level_id: uuid.UUID | None = None
    credit_limit: MoneyIn | None = None
    notes: str | None = Field(default=None, max_length=5000)


class CustomerUpdate(Schema):
    code: str | None = Field(default=None, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, max_length=50)
    email: EmailStr | None = None
    address: str | None = Field(default=None, max_length=500)
    tin: str | None = Field(default=None, max_length=32)
    price_level_id: uuid.UUID | None = None
    credit_limit: MoneyIn | None = None
    notes: str | None = Field(default=None, max_length=5000)
    is_active: bool | None = None


class CustomerSync(ResponseSchema):
    """Row shape sent to terminals."""

    id: uuid.UUID
    code: str | None
    name: str
    phone: str | None
    email: str | None
    price_level_id: uuid.UUID | None
    is_active: bool
