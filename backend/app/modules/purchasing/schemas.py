import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import Field

from app.modules.purchasing.models import POStatus
from app.shared.schemas import ResponseSchema, Schema

PositiveQty = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=3)]
CostIn = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=4)]


class POLineIn(Schema):
    variant_id: uuid.UUID
    unit_id: uuid.UUID | None = Field(default=None, description="units.id; null = base unit")
    quantity: PositiveQty
    unit_cost: CostIn = Field(description="Cost per ordered unit")


class POCreate(Schema):
    supplier_id: uuid.UUID
    stock_location_id: uuid.UUID
    order_date: date | None = None
    expected_date: date | None = None
    notes: str | None = Field(default=None, max_length=1000)
    lines: list[POLineIn] = Field(min_length=1, max_length=500)


class POUpdate(Schema):
    """Draft purchase orders only. `lines` replaces all lines when given."""

    expected_date: date | None = None
    notes: str | None = Field(default=None, max_length=1000)
    lines: list[POLineIn] | None = Field(default=None, min_length=1, max_length=500)


class POLineRead(ResponseSchema):
    id: uuid.UUID
    line_no: int
    variant_id: uuid.UUID
    product_unit_id: uuid.UUID
    unit_factor: Decimal
    quantity: Decimal
    base_quantity: Decimal
    unit_cost: Decimal
    line_total: Decimal
    received_base_quantity: Decimal


class PORead(ResponseSchema):
    id: uuid.UUID
    number: str
    supplier_id: uuid.UUID
    branch_id: uuid.UUID
    stock_location_id: uuid.UUID
    status: POStatus
    order_date: date
    expected_date: date | None
    notes: str | None
    total: Decimal
    created_by_id: uuid.UUID
    approved_by_id: uuid.UUID | None
    approved_at: datetime | None
    closed_at: datetime | None
    created_at: datetime
    lines: list[POLineRead]


class ReceiptLineIn(Schema):
    purchase_order_line_id: uuid.UUID | None = None
    variant_id: uuid.UUID | None = Field(default=None, description="Required without a PO line")
    unit_id: uuid.UUID | None = None
    quantity: PositiveQty
    unit_cost: CostIn | None = Field(default=None, description="Defaults to the PO line cost")
    lot_no: str | None = Field(default=None, max_length=64)
    expiry_date: date | None = None


class ReceiptCreate(Schema):
    supplier_id: uuid.UUID | None = Field(default=None, description="Required without a PO")
    purchase_order_id: uuid.UUID | None = None
    stock_location_id: uuid.UUID | None = Field(
        default=None, description="Defaults to the PO's delivery location"
    )
    supplier_invoice_no: str | None = Field(default=None, max_length=64)
    notes: str | None = Field(default=None, max_length=1000)
    lines: list[ReceiptLineIn] = Field(min_length=1, max_length=500)


class ReceiptLineRead(ResponseSchema):
    id: uuid.UUID
    line_no: int
    purchase_order_line_id: uuid.UUID | None
    variant_id: uuid.UUID
    product_unit_id: uuid.UUID
    quantity: Decimal
    base_quantity: Decimal
    unit_cost: Decimal
    base_unit_cost: Decimal
    line_total: Decimal
    lot_no: str | None
    expiry_date: date | None


class ReceiptRead(ResponseSchema):
    id: uuid.UUID
    number: str
    supplier_id: uuid.UUID
    purchase_order_id: uuid.UUID | None
    branch_id: uuid.UUID
    stock_location_id: uuid.UUID
    supplier_invoice_no: str | None
    notes: str | None
    total_cost: Decimal
    received_by_id: uuid.UUID
    received_at: datetime
    lines: list[ReceiptLineRead]
