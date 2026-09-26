"""Purchase orders and goods receipts (Phase 6).

Only a goods receipt changes stock (PURCHASE movements) and costs (moving average). A purchase
order is a commitment document; it tracks how much of each line has been received.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.modules.products.models import UnitFactor
from app.shared.models import (
    Base,
    CompanyScopedMixin,
    Money,
    Quantity,
    TimestampMixin,
    UnitCost,
    UUIDPrimaryKeyMixin,
)


class POStatus(StrEnum):
    DRAFT = "DRAFT"
    APPROVED = "APPROVED"
    PARTIALLY_RECEIVED = "PARTIALLY_RECEIVED"
    RECEIVED = "RECEIVED"
    CLOSED = "CLOSED"  # closed short by a manager
    CANCELLED = "CANCELLED"


class PurchaseOrder(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, Base):
    __tablename__ = "purchase_orders"
    __table_args__ = (
        UniqueConstraint("company_id", "number"),
        CheckConstraint(
            "status IN ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', "
            "'CANCELLED')",
            name="status",
        ),
    )

    number: Mapped[str] = mapped_column(String(32))
    supplier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("suppliers.id"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    stock_location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_locations.id"))
    status: Mapped[POStatus] = mapped_column(String(24), server_default=POStatus.DRAFT.value)
    order_date: Mapped[date] = mapped_column(Date)
    expected_date: Mapped[date | None] = mapped_column(Date)
    notes: Mapped[str | None] = mapped_column(String(1000))
    total: Mapped[Decimal] = mapped_column(Money)
    created_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    approved_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    approved_at: Mapped[datetime | None]
    closed_at: Mapped[datetime | None]

    lines: Mapped[list["PurchaseOrderLine"]] = relationship(
        lazy="raise", order_by="PurchaseOrderLine.line_no", cascade="all, delete-orphan"
    )


class PurchaseOrderLine(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "purchase_order_lines"
    __table_args__ = (
        UniqueConstraint("purchase_order_id", "line_no"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        CheckConstraint("unit_cost >= 0", name="unit_cost_non_negative"),
    )

    purchase_order_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("purchase_orders.id", ondelete="CASCADE"), index=True
    )
    line_no: Mapped[int] = mapped_column(Integer)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"))
    product_unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_units.id"))
    unit_factor: Mapped[Decimal] = mapped_column(UnitFactor)
    quantity: Mapped[Decimal] = mapped_column(Quantity)  # in the ordered unit
    base_quantity: Mapped[Decimal] = mapped_column(Quantity)
    unit_cost: Mapped[Decimal] = mapped_column(UnitCost)  # per ordered unit
    line_total: Mapped[Decimal] = mapped_column(Money)
    received_base_quantity: Mapped[Decimal] = mapped_column(Quantity, server_default="0")


class GoodsReceipt(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "goods_receipts"
    __table_args__ = (UniqueConstraint("company_id", "number"),)

    number: Mapped[str] = mapped_column(String(32))
    supplier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("suppliers.id"), index=True)
    purchase_order_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("purchase_orders.id"), index=True
    )
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    stock_location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_locations.id"))
    supplier_invoice_no: Mapped[str | None] = mapped_column(String(64))
    notes: Mapped[str | None] = mapped_column(String(1000))
    total_cost: Mapped[Decimal] = mapped_column(Money)
    received_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    received_at: Mapped[datetime] = mapped_column(server_default=func.now())

    lines: Mapped[list["GoodsReceiptLine"]] = relationship(
        lazy="raise", order_by="GoodsReceiptLine.line_no"
    )


class GoodsReceiptLine(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "goods_receipt_lines"
    __table_args__ = (
        UniqueConstraint("goods_receipt_id", "line_no"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
    )

    goods_receipt_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("goods_receipts.id", ondelete="CASCADE"), index=True
    )
    line_no: Mapped[int] = mapped_column(Integer)
    purchase_order_line_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("purchase_order_lines.id")
    )
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"))
    product_unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_units.id"))
    quantity: Mapped[Decimal] = mapped_column(Quantity)
    base_quantity: Mapped[Decimal] = mapped_column(Quantity)
    unit_cost: Mapped[Decimal] = mapped_column(UnitCost)  # per received unit
    base_unit_cost: Mapped[Decimal] = mapped_column(UnitCost)  # per base unit
    line_total: Mapped[Decimal] = mapped_column(Money)
    lot_no: Mapped[str | None] = mapped_column(String(64))
    expiry_date: Mapped[date | None] = mapped_column(Date)
