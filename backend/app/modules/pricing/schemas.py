import uuid
from decimal import Decimal
from typing import Annotated

from pydantic import Field, StringConstraints

from app.modules.pricing.models import TaxKind
from app.shared.schemas import ResponseSchema, Schema

Code16 = Annotated[str, StringConstraints(min_length=1, max_length=16, pattern=r"^[A-Z0-9_]+$")]
MoneyIn = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]
QuantityIn = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=3)]


class TaxRateRead(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    rate: Decimal
    kind: TaxKind
    is_default: bool
    is_active: bool


class TaxRateCreate(Schema):
    code: Code16
    name: str = Field(min_length=1, max_length=50)
    rate: Annotated[Decimal, Field(ge=0, lt=100, max_digits=6, decimal_places=3)]
    kind: TaxKind
    is_default: bool = False


class TaxRateUpdate(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    rate: Annotated[Decimal, Field(ge=0, lt=100, max_digits=6, decimal_places=3)] | None = None
    kind: TaxKind | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class PriceLevelRead(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    is_default: bool
    sort_order: int
    is_active: bool


class PriceLevelCreate(Schema):
    code: Code16
    name: str = Field(min_length=1, max_length=50)
    sort_order: int = 0


class PriceLevelUpdate(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=50)
    sort_order: int | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class PriceIn(Schema):
    """One price entry.

    `unit_id` (a `units.id`) null means the product's base unit; `price_level_id` null means the
    company's default level; `branch_id` null means all branches.
    """

    price: MoneyIn
    price_level_id: uuid.UUID | None = None
    unit_id: uuid.UUID | None = None
    branch_id: uuid.UUID | None = None
    min_quantity: QuantityIn = Decimal("1")


class PriceRead(ResponseSchema):
    id: uuid.UUID
    variant_id: uuid.UUID
    product_unit_id: uuid.UUID
    price_level_id: uuid.UUID
    branch_id: uuid.UUID | None
    min_quantity: Decimal
    price: Decimal
    is_active: bool


class SetPricesRequest(Schema):
    prices: list[PriceIn] = Field(max_length=200)
