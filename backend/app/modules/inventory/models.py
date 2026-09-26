"""Inventory ledger. See docs/INVENTORY_LEDGER.md.

`inventory_movements` is append-only (enforced by trigger) and is the source of truth.
`inventory_balances` is a cache maintained in the same transaction as each movement.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import IntEnum, StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Computed,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.shared.models import (
    Base,
    CompanyScopedMixin,
    Quantity,
    SyncTrackedMixin,
    UnitCost,
    UUIDPrimaryKeyMixin,
    sync_index,
)


class Direction(IntEnum):
    IN = 1
    OUT = -1


class MovementType(StrEnum):
    INITIAL_STOCK = "INITIAL_STOCK"
    PURCHASE = "PURCHASE"
    PURCHASE_RETURN = "PURCHASE_RETURN"
    SALE = "SALE"
    SALE_RETURN = "SALE_RETURN"
    SALE_VOID = "SALE_VOID"
    TRANSFER_OUT = "TRANSFER_OUT"
    TRANSFER_IN = "TRANSFER_IN"
    ADJUSTMENT_IN = "ADJUSTMENT_IN"
    ADJUSTMENT_OUT = "ADJUSTMENT_OUT"
    DAMAGED = "DAMAGED"
    EXPIRED = "EXPIRED"
    STOCK_COUNT = "STOCK_COUNT"


# The direction each type implies. STOCK_COUNT may go either way.
MOVEMENT_DIRECTIONS: dict[MovementType, Direction | None] = {
    MovementType.INITIAL_STOCK: Direction.IN,
    MovementType.PURCHASE: Direction.IN,
    MovementType.PURCHASE_RETURN: Direction.OUT,
    MovementType.SALE: Direction.OUT,
    MovementType.SALE_RETURN: Direction.IN,
    MovementType.SALE_VOID: Direction.IN,
    MovementType.TRANSFER_OUT: Direction.OUT,
    MovementType.TRANSFER_IN: Direction.IN,
    MovementType.ADJUSTMENT_IN: Direction.IN,
    MovementType.ADJUSTMENT_OUT: Direction.OUT,
    MovementType.DAMAGED: Direction.OUT,
    MovementType.EXPIRED: Direction.OUT,
    MovementType.STOCK_COUNT: None,
}

_MOVEMENT_TYPES_SQL = ", ".join(f"'{t.value}'" for t in MovementType)


class InventoryMovement(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "inventory_movements"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("direction IN (1, -1)", name="direction"),
        CheckConstraint(f"movement_type IN ({_MOVEMENT_TYPES_SQL})", name="movement_type"),
        Index("ix_inventory_movements_variant_location", "variant_id", "stock_location_id"),
        Index("ix_inventory_movements_reference", "reference_type", "reference_id"),
        Index("ix_inventory_movements_company_occurred", "company_id", text("occurred_at DESC")),
    )

    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    stock_location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_locations.id"))
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"), index=True)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"))
    quantity: Mapped[Decimal] = mapped_column(Quantity)  # always positive, base units
    direction: Mapped[int] = mapped_column(SmallInteger)
    signed_quantity: Mapped[Decimal] = mapped_column(
        Quantity, Computed("quantity * direction", persisted=True)
    )
    movement_type: Mapped[MovementType] = mapped_column(String(24))
    reference_type: Mapped[str | None] = mapped_column(String(32))
    reference_id: Mapped[uuid.UUID | None]
    unit_cost: Mapped[Decimal | None] = mapped_column(UnitCost)
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id"))
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    note: Mapped[str | None] = mapped_column(String(500))
    occurred_at: Mapped[datetime]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class InventoryBalance(CompanyScopedMixin, SyncTrackedMixin, Base):
    """Current quantity per item per location (cache of SUM(signed_quantity))."""

    __tablename__ = "inventory_balances"
    __table_args__ = (
        sync_index("inventory_balances"),
        Index("ix_inventory_balances_branch", "branch_id"),
    )

    stock_location_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("stock_locations.id"), primary_key=True
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("product_variants.id"), primary_key=True
    )
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"))
    quantity: Mapped[Decimal] = mapped_column(Quantity, server_default=text("0"))
    last_movement_at: Mapped[datetime | None]
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


# --- Inventory documents (Phase 5) ---------------------------------------------------------
# Each document posts ledger movements that reference it (reference_type/reference_id).


class AdjustmentReason(StrEnum):
    ADJUSTMENT_IN = "ADJUSTMENT_IN"
    ADJUSTMENT_OUT = "ADJUSTMENT_OUT"
    DAMAGED = "DAMAGED"
    EXPIRED = "EXPIRED"


class StockAdjustment(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    """A posted, reasoned stock correction (e.g. breakage, found stock, expiry)."""

    __tablename__ = "stock_adjustments"
    __table_args__ = (Index("ix_stock_adjustments_company_created", "company_id", "created_at"),)

    number: Mapped[str] = mapped_column(String(32))
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"))
    stock_location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_locations.id"))
    reason: Mapped[str] = mapped_column(String(200))
    note: Mapped[str | None] = mapped_column(String(500))
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    lines: Mapped[list["StockAdjustmentLine"]] = relationship(lazy="raise")


class StockAdjustmentLine(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "stock_adjustment_lines"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint(
            "movement_type IN ('ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'DAMAGED', 'EXPIRED')",
            name="movement_type",
        ),
    )

    adjustment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("stock_adjustments.id", ondelete="CASCADE"), index=True
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"))
    product_unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_units.id"))
    movement_type: Mapped[AdjustmentReason] = mapped_column(String(24))
    quantity: Mapped[Decimal] = mapped_column(Quantity)
    base_quantity: Mapped[Decimal] = mapped_column(Quantity)
    unit_cost: Mapped[Decimal | None] = mapped_column(UnitCost)


class StockCountStatus(StrEnum):
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"


class StockCount(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    """A physical count. See docs/INVENTORY_LEDGER.md §8."""

    __tablename__ = "stock_counts"
    __table_args__ = (
        CheckConstraint("status IN ('IN_PROGRESS', 'COMPLETED', 'CANCELLED')", name="status"),
    )

    number: Mapped[str] = mapped_column(String(32))
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    stock_location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_locations.id"))
    status: Mapped[StockCountStatus] = mapped_column(
        String(16), server_default=StockCountStatus.IN_PROGRESS.value
    )
    # Full count: items never counted are treated as counted zero when completing.
    is_full: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    note: Mapped[str | None] = mapped_column(String(500))
    started_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    started_at: Mapped[datetime] = mapped_column(server_default=func.now())
    completed_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    completed_at: Mapped[datetime | None]

    lines: Mapped[list["StockCountLine"]] = relationship(lazy="raise")


class StockCountLine(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "stock_count_lines"
    __table_args__ = (
        UniqueConstraint("stock_count_id", "variant_id"),
        CheckConstraint("counted_quantity >= 0", name="counted_non_negative"),
    )

    stock_count_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("stock_counts.id", ondelete="CASCADE"), index=True
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"))
    counted_quantity: Mapped[Decimal] = mapped_column(Quantity)  # base units
    # System balance at the moment this line was last counted (not at count start or end), so
    # sales during the count are not mistaken for variance.
    system_quantity: Mapped[Decimal] = mapped_column(Quantity)
    variance: Mapped[Decimal | None] = mapped_column(Quantity)  # set on completion
    counted_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    counted_at: Mapped[datetime] = mapped_column(server_default=func.now())


class TransferStatus(StrEnum):
    DRAFT = "DRAFT"
    IN_TRANSIT = "IN_TRANSIT"
    RECEIVED = "RECEIVED"
    CANCELLED = "CANCELLED"


class StockTransfer(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "stock_transfers"
    __table_args__ = (
        CheckConstraint(
            "status IN ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED')", name="status"
        ),
        CheckConstraint("from_location_id <> to_location_id", name="different_locations"),
    )

    number: Mapped[str] = mapped_column(String(32))
    from_location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_locations.id"))
    to_location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_locations.id"))
    from_branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    to_branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    status: Mapped[TransferStatus] = mapped_column(
        String(16), server_default=TransferStatus.DRAFT.value
    )
    note: Mapped[str | None] = mapped_column(String(500))
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    sent_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    sent_at: Mapped[datetime | None]
    received_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    received_at: Mapped[datetime | None]

    lines: Mapped[list["StockTransferLine"]] = relationship(lazy="raise")


class StockTransferLine(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "stock_transfer_lines"
    __table_args__ = (CheckConstraint("quantity > 0", name="quantity_positive"),)

    transfer_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("stock_transfers.id", ondelete="CASCADE"), index=True
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"))
    product_unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_units.id"))
    quantity: Mapped[Decimal] = mapped_column(Quantity)
    base_quantity: Mapped[Decimal] = mapped_column(Quantity)
    received_base_quantity: Mapped[Decimal | None] = mapped_column(Quantity)
