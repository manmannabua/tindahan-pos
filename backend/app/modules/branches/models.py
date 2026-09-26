import uuid
from enum import StrEnum

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, String, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.shared.models import (
    Base,
    CompanyScopedMixin,
    SyncTrackedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    sync_index,
)


class Branch(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    """A physical store."""

    __tablename__ = "branches"
    __table_args__ = (UniqueConstraint("company_id", "code"), sync_index("branches"))

    code: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str | None] = mapped_column(String(500))
    phone: Mapped[str | None] = mapped_column(String(50))
    tin: Mapped[str | None] = mapped_column(String(32))
    receipt_header: Mapped[str | None] = mapped_column(String(1000))
    receipt_footer: Mapped[str | None] = mapped_column(String(1000))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    locations: Mapped[list["StockLocation"]] = relationship(
        back_populates="branch", lazy="raise", order_by="StockLocation.code"
    )


class LocationType(StrEnum):
    STORE = "STORE"
    BACKROOM = "BACKROOM"
    WAREHOUSE = "WAREHOUSE"


class StockLocation(
    UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base
):
    """Where stock physically sits. A branch sells from its default location."""

    __tablename__ = "stock_locations"
    __table_args__ = (
        UniqueConstraint("branch_id", "code"),
        sync_index("stock_locations"),
        CheckConstraint(
            "location_type IN ('STORE', 'BACKROOM', 'WAREHOUSE')", name="location_type"
        ),
        # At most one default location per branch.
        Index(
            "uq_stock_locations_default_per_branch",
            "branch_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    branch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), index=True
    )
    code: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(200))
    location_type: Mapped[LocationType] = mapped_column(String(16), default=LocationType.STORE)
    is_default: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    branch: Mapped[Branch] = relationship(back_populates="locations", lazy="raise")
