import uuid
from decimal import Decimal

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import (
    Base,
    CompanyScopedMixin,
    Money,
    SyncTrackedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    sync_index,
)


class Customer(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    """A customer. May be created on a POS terminal while offline (client UUID as id)."""

    __tablename__ = "customers"
    __table_args__ = (
        Index("ix_customers_company_phone", "company_id", "phone"),
        Index("ix_customers_company_name", "company_id", "name"),
        Index(
            "ix_customers_name_trgm",
            "name",
            postgresql_using="gin",
            postgresql_ops={"name": "gin_trgm_ops"},
        ),
        sync_index("customers"),
    )

    code: Mapped[str | None] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(50))
    email: Mapped[str | None] = mapped_column(String(254))
    address: Mapped[str | None] = mapped_column(String(500))
    tin: Mapped[str | None] = mapped_column(String(32))
    price_level_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("price_levels.id"))
    credit_limit: Mapped[Decimal | None] = mapped_column(Money)
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    created_on_device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id"))
