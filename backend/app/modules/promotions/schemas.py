import uuid
from datetime import datetime, time
from decimal import Decimal
from typing import Annotated, Any

from pydantic import Field, model_validator

from app.modules.promotions.models import PromotionKind, TargetType
from app.shared.schemas import ResponseSchema, Schema

Qty = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=3)]
MoneyIn = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]


class TargetIn(Schema):
    type: TargetType
    id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _id_required(self) -> "TargetIn":
        if (self.type == TargetType.ALL) != (self.id is None):
            raise ValueError("id is required for every target type except ALL")
        return self


class PromotionBase(Schema):
    name: str = Field(min_length=2, max_length=200)
    kind: PromotionKind
    value: MoneyIn = Decimal(0)
    buy_quantity: Qty | None = None
    get_quantity: Qty | None = None
    min_quantity: Qty = Decimal(1)
    targets: list[TargetIn] = Field(min_length=1, max_length=500)
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    days_of_week: list[Annotated[int, Field(ge=1, le=7)]] | None = None
    start_time: time | None = None
    end_time: time | None = None
    branch_ids: list[uuid.UUID] | None = None
    priority: int = 0
    is_active: bool = True

    @model_validator(mode="after")
    def _consistent(self) -> "PromotionBase":
        if self.kind == PromotionKind.PERCENT_OFF and self.value > 100:
            raise ValueError("Percent cannot exceed 100")
        if self.kind == PromotionKind.BUY_X_GET_Y and not (self.buy_quantity and self.get_quantity):
            raise ValueError("buy_quantity and get_quantity are required for BUY_X_GET_Y")
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError("ends_at must be after starts_at")
        if (self.start_time is None) != (self.end_time is None):
            raise ValueError("start_time and end_time go together")
        return self


class PromotionCreate(PromotionBase):
    pass


class PromotionUpdate(PromotionBase):
    """Full replacement: promotions are edited and synced as one unit."""


class PromotionRead(ResponseSchema):
    id: uuid.UUID
    name: str
    kind: PromotionKind
    value: Decimal
    buy_quantity: Decimal | None
    get_quantity: Decimal | None
    min_quantity: Decimal
    targets: list[dict[str, Any]]
    starts_at: datetime | None
    ends_at: datetime | None
    days_of_week: list[int] | None
    start_time: time | None
    end_time: time | None
    branch_ids: list[uuid.UUID] | None
    priority: int
    is_active: bool
