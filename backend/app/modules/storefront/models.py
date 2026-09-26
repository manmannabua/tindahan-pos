import uuid
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import ARRAY, Boolean, CheckConstraint, String, UniqueConstraint, Uuid, text
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import (
    Base,
    CompanyScopedMixin,
    Quantity,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
)


class StockDisplay(StrEnum):
    AVAILABILITY = "AVAILABILITY"  # In stock / Low stock / Out of stock
    QUANTITY = "QUANTITY"  # exact on-hand quantity
    HIDDEN = "HIDDEN"  # no stock information at all


class Storefront(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, Base):
    """A company's public, browse-only online catalog (one per company).

    Not sync-tracked: POS terminals never need it. Which products appear is decided per product
    (`products.show_online`); this row decides whether the catalog exists at all and what it shows.
    """

    __tablename__ = "storefronts"
    __table_args__ = (
        UniqueConstraint("company_id"),
        UniqueConstraint("slug"),
        CheckConstraint("low_stock_threshold >= 0", name="low_stock_threshold_non_negative"),
    )

    slug: Mapped[str] = mapped_column(String(48))
    enabled: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    # Branches whose stock and prices customers may see, in display order.
    branch_ids: Mapped[list[uuid.UUID]] = mapped_column(
        ARRAY(Uuid), server_default=text("'{}'::uuid[]")
    )
    stock_display: Mapped[StockDisplay] = mapped_column(
        String(16), server_default=StockDisplay.AVAILABILITY.value
    )
    low_stock_threshold: Mapped[Decimal] = mapped_column(Quantity, server_default=text("5"))
    show_prices: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    allow_indexing: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    about: Mapped[str | None] = mapped_column(String(1000))
    phone: Mapped[str | None] = mapped_column(String(50))
    messenger_url: Mapped[str | None] = mapped_column(String(300))
    hours: Mapped[str | None] = mapped_column(String(200))
