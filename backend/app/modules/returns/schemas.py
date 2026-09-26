import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from pydantic import Field

from app.shared.schemas import ResponseSchema, Schema

PositiveQty = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=3)]
PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]


class ReturnItemIn(Schema):
    id: uuid.UUID | None = None
    sale_item_id: uuid.UUID
    quantity: PositiveQty
    restock: bool = True


class RefundIn(Schema):
    id: uuid.UUID | None = None
    payment_method_id: uuid.UUID
    amount: PositiveMoney
    reference_no: str | None = Field(default=None, max_length=100)


class ReturnCreate(Schema):
    id: uuid.UUID | None = None
    sale_id: uuid.UUID
    reason: str = Field(min_length=3, max_length=300)
    authorized_by_id: uuid.UUID | None = None
    items: list[ReturnItemIn] = Field(min_length=1, max_length=500)
    refunds: list[RefundIn] = Field(min_length=1, max_length=10)


class VoidRequest(Schema):
    reason: str = Field(min_length=3, max_length=300)


class ReturnItemRead(ResponseSchema):
    id: uuid.UUID
    sale_item_id: uuid.UUID
    variant_id: uuid.UUID
    quantity: Decimal
    base_quantity: Decimal
    refund_amount: Decimal
    restock: bool


class RefundRead(ResponseSchema):
    id: uuid.UUID
    payment_method_id: uuid.UUID
    method_kind: str
    amount: Decimal
    reference_no: str | None


class ReturnRead(ResponseSchema):
    id: uuid.UUID
    original_sale_id: uuid.UUID
    branch_id: uuid.UUID
    return_number: str
    cashier_id: uuid.UUID
    authorized_by_id: uuid.UUID | None
    reason: str
    refund_total: Decimal
    occurred_at: datetime
    items: list[ReturnItemRead]
    refunds: list[RefundRead]
