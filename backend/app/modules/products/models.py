import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.modules.pricing.models import Price
from app.modules.units.models import Unit
from app.shared.models import (
    Base,
    CompanyScopedMixin,
    Quantity,
    SyncTrackedMixin,
    TimestampMixin,
    UnitCost,
    UUIDPrimaryKeyMixin,
    sync_index,
)

# Unit conversion factors: "1 BOX = 12 PC", "1 G = 0.001 KG".
UnitFactor = Numeric(14, 6)


class Product(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    """The product concept (e.g. "Coke 1.5L"). What is sold and stocked is a variant."""

    __tablename__ = "products"
    __table_args__ = (
        sync_index("products"),
        # Trigram index: fast `ILIKE '%text%'` product search (requires the pg_trgm extension).
        Index(
            "ix_products_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
        # The public catalog lists only published products of one company, by name.
        Index(
            "ix_products_online",
            "company_id",
            "name",
            postgresql_where=text("show_online AND is_active"),
        ),
    )

    name: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), index=True
    )
    brand_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("brands.id", ondelete="SET NULL"), index=True
    )
    base_unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id"))
    tax_rate_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tax_rates.id"))
    # False for services / non-stock items: no inventory movements are posted.
    track_inventory: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    # Qualifies for the senior citizen / PWD discount (RA 9994 / RA 10754), e.g. medicines.
    sc_pwd_eligible: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    image_url: Mapped[str | None] = mapped_column(String(500))
    # Listed in the public online catalog (storefront module). Opt-in per product.
    show_online: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    variants: Mapped[list["ProductVariant"]] = relationship(
        back_populates="product", lazy="raise", order_by="ProductVariant.sku"
    )
    units: Mapped[list["ProductUnit"]] = relationship(
        back_populates="product", lazy="raise", order_by="ProductUnit.factor"
    )


class ProductUnit(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    """A unit a product can be sold/bought in, with its conversion to the base unit."""

    __tablename__ = "product_units"
    __table_args__ = (
        UniqueConstraint("product_id", "unit_id"),
        CheckConstraint("factor > 0", name="factor_positive"),
        CheckConstraint("NOT is_base OR factor = 1", name="base_factor_one"),
        Index(
            "uq_product_units_base_per_product",
            "product_id",
            unique=True,
            postgresql_where=text("is_base"),
        ),
        sync_index("product_units"),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("units.id"))
    factor: Mapped[Decimal] = mapped_column(UnitFactor)
    is_base: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    product: Mapped[Product] = relationship(back_populates="units", lazy="raise")
    unit: Mapped[Unit] = relationship(lazy="raise")


class ProductVariant(
    UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base
):
    """The sellable, stockable item. Simple products have exactly one (default) variant."""

    __tablename__ = "product_variants"
    __table_args__ = (
        UniqueConstraint("company_id", "sku"),
        Index(
            "uq_product_variants_default_per_product",
            "product_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
        CheckConstraint("average_cost >= 0", name="average_cost_non_negative"),
        sync_index("product_variants"),
        Index(
            "ix_product_variants_sku_trgm",
            "sku",
            postgresql_using="gin",
            postgresql_ops={"sku": "gin_trgm_ops"},
        ),
    )

    product_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), index=True
    )
    sku: Mapped[str] = mapped_column(String(64))
    # Variant-specific label ("Red / L"). NULL for a simple product's only variant.
    name: Mapped[str | None] = mapped_column(String(200))
    attributes: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    average_cost: Mapped[Decimal] = mapped_column(UnitCost, server_default=text("0"))
    last_cost: Mapped[Decimal | None] = mapped_column(UnitCost)
    reorder_point: Mapped[Decimal | None] = mapped_column(Quantity)
    is_default: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    product: Mapped[Product] = relationship(back_populates="variants", lazy="raise")
    barcodes: Mapped[list["Barcode"]] = relationship(
        back_populates="variant", lazy="raise", order_by="Barcode.code"
    )
    prices: Mapped[list[Price]] = relationship(lazy="raise", order_by=Price.min_quantity)


class Barcode(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    """A scannable code for a variant *in a specific unit* (the case barcode sells a case).

    One row per code, ever: reassigning or removing a code updates/deactivates this row instead
    of inserting a new one, so offline terminals receive the change as an update to the same
    record (their local barcode index is unique by code).
    """

    __tablename__ = "barcodes"
    __table_args__ = (UniqueConstraint("company_id", "code"), sync_index("barcodes"))

    variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("product_variants.id", ondelete="CASCADE"), index=True
    )
    product_unit_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("product_units.id", ondelete="CASCADE")
    )
    code: Mapped[str] = mapped_column(String(64))
    symbology: Mapped[str] = mapped_column(String(20))
    is_primary: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    variant: Mapped[ProductVariant] = relationship(back_populates="barcodes", lazy="raise")
