"""Storefront schemas.

Admin schemas configure the catalog. Public schemas are what anonymous visitors receive: they
are deliberately separate from the product schemas and list every field explicitly, so an
internal field (cost, supplier, SKU, …) can never reach the public by being added to a shared
model. `tests/integration/test_storefront_public.py` pins the exact public field sets.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated

from pydantic import BeforeValidator, Field, StringConstraints, field_validator, model_validator

from app.modules.storefront.models import StockDisplay
from app.shared.schemas import ResponseSchema, Schema

Slug = Annotated[
    str,
    # Normalised before validation: "  My-Store " is accepted as "my-store".
    BeforeValidator(lambda v: v.strip().lower() if isinstance(v, str) else v),
    StringConstraints(min_length=3, max_length=48, pattern=r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"),
]

MAX_BULK_PRODUCTS = 1000


# ---------------------------------------------------------------- admin


class StorefrontRead(ResponseSchema):
    configured: bool = Field(description="False until the owner saves the settings once")
    slug: str
    enabled: bool
    branch_ids: list[uuid.UUID]
    stock_display: StockDisplay
    low_stock_threshold: Decimal
    show_prices: bool
    allow_indexing: bool
    about: str | None
    phone: str | None
    messenger_url: str | None
    hours: str | None
    published_products: int = Field(description="Active products shown online")


class StorefrontUpdate(Schema):
    slug: Slug
    enabled: bool
    branch_ids: list[uuid.UUID] = Field(max_length=50)
    stock_display: StockDisplay = StockDisplay.AVAILABILITY
    low_stock_threshold: Decimal = Field(default=Decimal(5), ge=0, max_digits=14, decimal_places=3)
    show_prices: bool = True
    allow_indexing: bool = False
    about: str | None = Field(default=None, max_length=1000)
    phone: str | None = Field(default=None, max_length=50)
    messenger_url: str | None = Field(default=None, max_length=300)
    hours: str | None = Field(default=None, max_length=200)

    @field_validator("about", "phone", "messenger_url", "hours", mode="after")
    @classmethod
    def _blank_to_none(cls, value: str | None) -> str | None:
        return value or None

    @field_validator("messenger_url", mode="after")
    @classmethod
    def _https_only(cls, value: str | None) -> str | None:
        # Rendered as a link on the public page: never allow javascript:/data: URLs.
        if value is not None and (
            not value.startswith("https://") or any(c.isspace() for c in value)
        ):
            raise ValueError("Must be an https:// link")
        return value

    @model_validator(mode="after")
    def _branches(self) -> "StorefrontUpdate":
        if len(set(self.branch_ids)) != len(self.branch_ids):
            raise ValueError("Duplicate branch")
        if self.enabled and not self.branch_ids:
            raise ValueError("Choose at least one branch to show online")
        return self


class ProductFilter(Schema):
    q: str | None = Field(default=None, max_length=100)
    category_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None
    include_inactive: bool = False
    online: bool | None = None


class ProductsOnlineUpdate(Schema):
    """Publish/unpublish either the listed products or every product matching a filter."""

    show_online: bool
    product_ids: list[uuid.UUID] | None = Field(
        default=None, min_length=1, max_length=MAX_BULK_PRODUCTS
    )
    filter: ProductFilter | None = None

    @model_validator(mode="after")
    def _one_target(self) -> "ProductsOnlineUpdate":
        if (self.product_ids is None) == (self.filter is None):
            raise ValueError("Give either product_ids or filter")
        return self


class ProductsOnlineResult(ResponseSchema):
    updated: int


# ---------------------------------------------------------------- public


class Availability(StrEnum):
    IN_STOCK = "IN_STOCK"
    LOW_STOCK = "LOW_STOCK"
    OUT_OF_STOCK = "OUT_OF_STOCK"


class PublicBranch(ResponseSchema):
    id: uuid.UUID
    name: str
    address: str | None
    phone: str | None
    synced_at: datetime | None = Field(description="Most recent terminal sync: stock is as of then")


class PublicCategory(ResponseSchema):
    id: uuid.UUID
    name: str
    product_count: int


class PublicStore(ResponseSchema):
    slug: str
    name: str
    about: str | None
    phone: str | None
    messenger_url: str | None
    hours: str | None
    currency: str
    show_prices: bool
    stock_display: StockDisplay
    allow_indexing: bool
    branches: list[PublicBranch]
    categories: list[PublicCategory]


class PublicProduct(ResponseSchema):
    id: uuid.UUID
    name: str
    brand: str | None
    category: str | None
    image_url: str | None
    unit: str = Field(description="Base unit name, e.g. 'piece' or 'kilogram'")
    unit_symbol: str | None = Field(
        description="'kg', 'g', 'l', … for measured (decimal) units; null for counted items"
    )
    price: Decimal | None = Field(description="Lowest variant price; null when prices are hidden")
    price_varies: bool
    availability: Availability | None = Field(description="Null when stock is hidden")
    quantity: Decimal | None = Field(description="Only when the store shows exact quantities")
    variant_count: int


class PublicVariant(ResponseSchema):
    id: uuid.UUID
    name: str | None
    price: Decimal | None
    availability: Availability | None
    quantity: Decimal | None


class PublicProductDetail(PublicProduct):
    description: str | None
    variants: list[PublicVariant]


class PublicProductPage(ResponseSchema):
    items: list[PublicProduct]
    total: int
    limit: int
    offset: int
    branch_id: uuid.UUID
    synced_at: datetime | None
