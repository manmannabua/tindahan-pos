from sqlalchemy import Boolean, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import (
    Base,
    CompanyScopedMixin,
    SyncTrackedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    sync_index,
)


class Unit(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    """Unit of measure (PC, BOX, KG, ...). Conversions are per product (`product_units`)."""

    __tablename__ = "units"
    __table_args__ = (UniqueConstraint("company_id", "code"), sync_index("units"))

    code: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(50))
    # Whether fractional quantities are allowed (KG yes, PC no).
    allows_decimal: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


# code -> (name, allows_decimal). Seeded for every new company.
DEFAULT_UNITS: dict[str, tuple[str, bool]] = {
    "PC": ("Piece", False),
    "PACK": ("Pack", False),
    "BOX": ("Box", False),
    "CASE": ("Case", False),
    "DOZEN": ("Dozen", False),
    "KG": ("Kilogram", True),
    "G": ("Gram", True),
    "L": ("Liter", True),
    "ML": ("Milliliter", True),
    "M": ("Meter", True),
}
