import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import Field, model_validator

from app.modules.inventory.models import AdjustmentReason, StockCountStatus, TransferStatus
from app.shared.schemas import ResponseSchema, Schema

PositiveQty = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=3)]
NonNegQty = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=3)]


class ItemRefIn(Schema):
    """An item by variant id or by barcode (scanner), optionally in a specific unit."""

    variant_id: uuid.UUID | None = None
    barcode: str | None = Field(default=None, max_length=64)
    unit_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _one_ref(self) -> "ItemRefIn":
        if (self.variant_id is None) == (self.barcode is None):
            raise ValueError("Provide exactly one of variant_id or barcode")
        return self


class AdjustmentLineIn(ItemRefIn):
    quantity: PositiveQty
    reason: AdjustmentReason


class AdjustmentCreate(Schema):
    stock_location_id: uuid.UUID
    reason: str = Field(min_length=3, max_length=200)
    note: str | None = Field(default=None, max_length=500)
    lines: list[AdjustmentLineIn] = Field(min_length=1, max_length=500)


class AdjustmentLineRead(ResponseSchema):
    id: uuid.UUID
    variant_id: uuid.UUID
    product_unit_id: uuid.UUID
    movement_type: str
    quantity: Decimal
    base_quantity: Decimal
    unit_cost: Decimal | None


class AdjustmentRead(ResponseSchema):
    id: uuid.UUID
    number: str
    branch_id: uuid.UUID
    stock_location_id: uuid.UUID
    reason: str
    note: str | None
    created_by_id: uuid.UUID
    created_at: datetime
    lines: list[AdjustmentLineRead]


class CountCreate(Schema):
    stock_location_id: uuid.UUID
    is_full: bool = False
    note: str | None = Field(default=None, max_length=500)


class CountLineIn(ItemRefIn):
    quantity: NonNegQty = Decimal(1)
    mode: Literal["SET", "ADD"] = Field(
        default="ADD", description="ADD: each scan adds `quantity`; SET: replace the count"
    )


class CountLineRead(ResponseSchema):
    id: uuid.UUID
    variant_id: uuid.UUID
    counted_quantity: Decimal
    system_quantity: Decimal
    variance: Decimal | None
    counted_by_id: uuid.UUID
    counted_at: datetime


class CountRead(ResponseSchema):
    id: uuid.UUID
    number: str
    branch_id: uuid.UUID
    stock_location_id: uuid.UUID
    status: StockCountStatus
    is_full: bool
    note: str | None
    started_by_id: uuid.UUID
    started_at: datetime
    completed_at: datetime | None
    lines: list[CountLineRead]


class TransferLineIn(ItemRefIn):
    quantity: PositiveQty


class TransferCreate(Schema):
    from_location_id: uuid.UUID
    to_location_id: uuid.UUID
    note: str | None = Field(default=None, max_length=500)
    lines: list[TransferLineIn] = Field(min_length=1, max_length=500)


class ReceiveLineIn(Schema):
    line_id: uuid.UUID
    received_base_quantity: NonNegQty


class TransferReceive(Schema):
    lines: list[ReceiveLineIn] = Field(
        default_factory=list, description="Only lines that differ from what was sent"
    )


class TransferLineRead(ResponseSchema):
    id: uuid.UUID
    variant_id: uuid.UUID
    product_unit_id: uuid.UUID
    quantity: Decimal
    base_quantity: Decimal
    received_base_quantity: Decimal | None


class TransferRead(ResponseSchema):
    id: uuid.UUID
    number: str
    from_location_id: uuid.UUID
    to_location_id: uuid.UUID
    from_branch_id: uuid.UUID
    to_branch_id: uuid.UUID
    status: TransferStatus
    note: str | None
    created_at: datetime
    sent_at: datetime | None
    received_at: datetime | None
    lines: list[TransferLineRead]
