import uuid
from datetime import datetime
from decimal import Decimal
from typing import Annotated

from pydantic import Field

from app.modules.inventory.models import MovementType
from app.shared.schemas import ResponseSchema, Schema

PositiveQty = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=3)]
CostIn = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=4)]


class BalanceRead(ResponseSchema):
    stock_location_id: uuid.UUID
    branch_id: uuid.UUID
    variant_id: uuid.UUID
    product_id: uuid.UUID
    product_name: str
    variant_name: str | None
    sku: str
    quantity: Decimal
    reorder_point: Decimal | None
    last_movement_at: datetime | None


class MovementRead(ResponseSchema):
    id: uuid.UUID
    branch_id: uuid.UUID
    stock_location_id: uuid.UUID
    product_id: uuid.UUID
    variant_id: uuid.UUID
    quantity: Decimal
    direction: int
    signed_quantity: Decimal
    movement_type: MovementType
    reference_type: str | None
    reference_id: uuid.UUID | None
    unit_cost: Decimal | None
    device_id: uuid.UUID | None
    user_id: uuid.UUID | None
    note: str | None
    occurred_at: datetime
    created_at: datetime


class InitialStockLine(Schema):
    variant_id: uuid.UUID
    quantity: PositiveQty = Field(description="In the product's base unit")
    unit_cost: CostIn | None = None


class InitialStockRequest(Schema):
    stock_location_id: uuid.UUID
    lines: list[InitialStockLine] = Field(min_length=1, max_length=1000)
    note: str | None = Field(default=None, max_length=500)


class PostingResultRead(ResponseSchema):
    posted: int
    skipped_untracked: int
    negative_balances: int
