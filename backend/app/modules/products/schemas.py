import uuid
from decimal import Decimal
from typing import Annotated, Any

from pydantic import Field, StringConstraints, model_validator

from app.modules.pricing.schemas import PriceIn, PriceRead
from app.shared.schemas import ResponseSchema, Schema

Sku = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._/-]+$")]
BarcodeCode = Annotated[str, StringConstraints(min_length=3, max_length=64)]
Factor = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=6)]
CostIn = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=4)]
QuantityIn = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=3)]


class ProductUnitIn(Schema):
    unit_id: uuid.UUID
    factor: Factor


class BarcodeIn(Schema):
    code: BarcodeCode
    unit_id: uuid.UUID | None = Field(default=None, description="units.id; null = base unit")
    is_primary: bool = False


class VariantIn(Schema):
    sku: Sku | None = Field(default=None, description="Generated when omitted")
    name: str | None = Field(default=None, max_length=200)
    attributes: dict[str, str] = Field(default_factory=dict)
    cost: CostIn | None = None
    reorder_point: QuantityIn | None = None
    barcodes: list[BarcodeIn] = Field(default_factory=list, max_length=20)
    prices: list[PriceIn] = Field(default_factory=list, max_length=50)


class ProductCreate(Schema):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    category_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None
    base_unit_id: uuid.UUID
    tax_rate_id: uuid.UUID | None = Field(default=None, description="null = default tax rate")
    track_inventory: bool = True
    image_url: str | None = Field(default=None, max_length=500)
    units: list[ProductUnitIn] = Field(
        default_factory=list, max_length=10, description="Additional units besides the base unit"
    )
    variants: list[VariantIn] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def _units_distinct(self) -> "ProductCreate":
        ids = [u.unit_id for u in self.units]
        if self.base_unit_id in ids or len(ids) != len(set(ids)):
            raise ValueError("units must be distinct and must not repeat the base unit")
        return self


class ProductUpdate(Schema):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    category_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None
    tax_rate_id: uuid.UUID | None = None
    track_inventory: bool | None = None
    image_url: str | None = Field(default=None, max_length=500)
    is_active: bool | None = None


class ProductUnitUpdate(Schema):
    factor: Factor | None = None
    is_active: bool | None = None


class VariantUpdate(Schema):
    sku: Sku | None = None
    name: str | None = Field(default=None, max_length=200)
    attributes: dict[str, str] | None = None
    reorder_point: QuantityIn | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class BarcodeUpdate(Schema):
    unit_id: uuid.UUID | None = None
    is_primary: bool | None = None
    is_active: bool | None = None


class GenerateBarcodeRequest(Schema):
    unit_id: uuid.UUID | None = None


class BarcodeRead(ResponseSchema):
    id: uuid.UUID
    variant_id: uuid.UUID
    product_unit_id: uuid.UUID
    code: str
    symbology: str
    is_primary: bool
    is_active: bool


class ProductUnitRead(ResponseSchema):
    id: uuid.UUID
    unit_id: uuid.UUID
    unit_code: str
    unit_name: str
    factor: Decimal
    is_base: bool
    is_active: bool


class VariantRead(ResponseSchema):
    id: uuid.UUID
    product_id: uuid.UUID
    sku: str
    name: str | None
    attributes: dict[str, Any]
    # Cost fields are null unless the caller may see costs.
    average_cost: Decimal | None
    last_cost: Decimal | None
    reorder_point: Decimal | None
    is_default: bool
    is_active: bool
    barcodes: list[BarcodeRead]
    prices: list[PriceRead]


class ProductRead(ResponseSchema):
    id: uuid.UUID
    name: str
    description: str | None
    category_id: uuid.UUID | None
    brand_id: uuid.UUID | None
    base_unit_id: uuid.UUID
    tax_rate_id: uuid.UUID
    track_inventory: bool
    image_url: str | None
    is_active: bool
    units: list[ProductUnitRead]
    variants: list[VariantRead]


class ProductSummary(ResponseSchema):
    id: uuid.UUID
    name: str
    category_id: uuid.UUID | None
    brand_id: uuid.UUID | None
    track_inventory: bool
    is_active: bool
    variant_count: int
    sku: str | None
    barcode: str | None
    price: Decimal | None = Field(description="Default price level, base unit, all branches, qty 1")


class BarcodeLookup(ResponseSchema):
    barcode: BarcodeRead
    product_id: uuid.UUID
    product_name: str
    variant_sku: str
