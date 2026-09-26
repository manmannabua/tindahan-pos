"""Row shapes sent to terminals by the pull endpoint (one schema per synced table).

They mirror the Dexie tables in `frontend/lib/db/schema.ts`. Soft-deleted rows arrive with
`is_active = false`; terminals must hide them, not drop the history they reference.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from app.shared.schemas import ResponseSchema


class CompanySync(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    legal_name: str | None
    tin: str | None
    currency: str
    timezone: str
    prices_include_tax: bool
    settings: dict[str, Any]


class BranchSync(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    address: str | None
    phone: str | None
    tin: str | None
    receipt_header: str | None
    receipt_footer: str | None
    is_active: bool


class StockLocationSync(ResponseSchema):
    id: uuid.UUID
    branch_id: uuid.UUID
    code: str
    name: str
    location_type: str
    is_default: bool
    is_active: bool


class CategorySync(ResponseSchema):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    sort_order: int
    is_active: bool


class BrandSync(ResponseSchema):
    id: uuid.UUID
    name: str
    is_active: bool


class UnitSync(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    allows_decimal: bool
    is_active: bool


class TaxRateSync(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    rate: Decimal
    kind: str
    is_default: bool
    is_active: bool


class PriceLevelSync(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    is_default: bool
    sort_order: int
    is_active: bool


class PaymentMethodSync(ResponseSchema):
    id: uuid.UUID
    code: str
    name: str
    kind: str
    requires_reference: bool
    opens_drawer: bool
    sort_order: int
    is_active: bool


class ProductSync(ResponseSchema):
    id: uuid.UUID
    name: str
    category_id: uuid.UUID | None
    brand_id: uuid.UUID | None
    base_unit_id: uuid.UUID
    tax_rate_id: uuid.UUID
    track_inventory: bool
    image_url: str | None
    is_active: bool


class ProductUnitSync(ResponseSchema):
    id: uuid.UUID
    product_id: uuid.UUID
    unit_id: uuid.UUID
    factor: Decimal
    is_base: bool
    is_active: bool


class VariantSync(ResponseSchema):
    id: uuid.UUID
    product_id: uuid.UUID
    sku: str
    name: str | None
    attributes: dict[str, Any]
    reorder_point: Decimal | None
    is_default: bool
    is_active: bool


class BarcodeSync(ResponseSchema):
    id: uuid.UUID
    variant_id: uuid.UUID
    product_unit_id: uuid.UUID
    code: str
    symbology: str
    is_primary: bool
    is_active: bool


class PriceSync(ResponseSchema):
    id: uuid.UUID
    variant_id: uuid.UUID
    product_unit_id: uuid.UUID
    price_level_id: uuid.UUID
    branch_id: uuid.UUID | None
    min_quantity: Decimal
    price: Decimal
    is_active: bool


class InventoryBalanceSync(ResponseSchema):
    stock_location_id: uuid.UUID
    variant_id: uuid.UUID
    quantity: Decimal
    updated_at: datetime
