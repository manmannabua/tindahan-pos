import uuid
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import (
    Base,
    CompanyScopedMixin,
    Money,
    Quantity,
    Rate,
    SyncTrackedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    sync_index,
)


class TaxKind(StrEnum):
    VATABLE = "VATABLE"
    EXEMPT = "EXEMPT"
    ZERO_RATED = "ZERO_RATED"


class TaxRate(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    __tablename__ = "tax_rates"
    __table_args__ = (
        UniqueConstraint("company_id", "code"),
        CheckConstraint("rate >= 0 AND rate < 100", name="rate_range"),
        CheckConstraint("kind IN ('VATABLE', 'EXEMPT', 'ZERO_RATED')", name="kind"),
        sync_index("tax_rates"),
    )

    code: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(50))
    rate: Mapped[Decimal] = mapped_column(Rate)
    # Receipts break totals down by kind (VATable sales, VAT-exempt sales, zero-rated sales).
    kind: Mapped[TaxKind] = mapped_column(String(16))
    is_default: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


# code -> (name, rate, kind, is_default). Philippine defaults; editable per company.
DEFAULT_TAX_RATES: dict[str, tuple[str, Decimal, TaxKind, bool]] = {
    "VAT12": ("VAT 12%", Decimal("12.000"), TaxKind.VATABLE, True),
    "VAT_EXEMPT": ("VAT Exempt", Decimal("0.000"), TaxKind.EXEMPT, False),
    "ZERO_RATED": ("Zero-rated", Decimal("0.000"), TaxKind.ZERO_RATED, False),
}


class PriceLevel(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    """A price list, e.g. RETAIL (default) and WHOLESALE. Customers may have a default level."""

    __tablename__ = "price_levels"
    __table_args__ = (
        UniqueConstraint("company_id", "code"),
        Index(
            "uq_price_levels_default_per_company",
            "company_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
        sync_index("price_levels"),
    )

    code: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(50))
    is_default: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    sort_order: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


DEFAULT_PRICE_LEVELS: dict[str, tuple[str, bool]] = {
    "RETAIL": ("Retail", True),
    "WHOLESALE": ("Wholesale", False),
}


class Price(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    """Selling price of a variant in a unit, for a price level, optionally per branch.

    Resolution (see app.modules.pricing.resolver): branch-specific beats company-wide; among
    those, the highest `min_quantity` not exceeding the sold quantity wins (quantity breaks).
    """

    __tablename__ = "prices"
    __table_args__ = (
        UniqueConstraint(
            "variant_id",
            "product_unit_id",
            "price_level_id",
            "branch_id",
            "min_quantity",
            postgresql_nulls_not_distinct=True,
        ),
        CheckConstraint("price >= 0", name="price_non_negative"),
        CheckConstraint("min_quantity > 0", name="min_quantity_positive"),
        sync_index("prices"),
    )

    variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("product_variants.id", ondelete="CASCADE"), index=True
    )
    product_unit_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("product_units.id", ondelete="CASCADE")
    )
    price_level_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("price_levels.id"))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE")
    )
    min_quantity: Mapped[Decimal] = mapped_column(Quantity, server_default=text("1"))
    price: Mapped[Decimal] = mapped_column(Money)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
