"""Customer returns and refunds (Phase 7). Offline-origin: ids are client UUIDs.

A return references the original sale's items. The refund per returned unit is the unit's
share of what the customer actually paid for that line (after discounts), so refunds can never
exceed the original payment.
"""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, String, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.shared.models import Base, CompanyScopedMixin, Money, Quantity, UUIDPrimaryKeyMixin


class SaleReturn(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "returns"

    original_sale_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sales.id"), index=True)
    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    stock_location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_locations.id"))
    device_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("devices.id"))
    cash_session_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("cash_sessions.id"))
    return_number: Mapped[str] = mapped_column(String(40))
    cashier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    authorized_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    reason: Mapped[str] = mapped_column(String(300))
    refund_total: Mapped[Decimal] = mapped_column(Money)
    occurred_at: Mapped[datetime]
    received_at: Mapped[datetime] = mapped_column(server_default=func.now())

    items: Mapped[list["ReturnItem"]] = relationship(lazy="raise")
    refunds: Mapped[list["Refund"]] = relationship(lazy="raise")


class ReturnItem(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "return_items"
    __table_args__ = (CheckConstraint("quantity > 0", name="quantity_positive"),)

    return_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("returns.id", ondelete="CASCADE"), index=True
    )
    sale_item_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sale_items.id"), index=True)
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"))
    quantity: Mapped[Decimal] = mapped_column(Quantity)  # in the unit it was sold in
    base_quantity: Mapped[Decimal] = mapped_column(Quantity)
    refund_amount: Mapped[Decimal] = mapped_column(Money)
    # False for damaged/unsellable goods: no SALE_RETURN movement is posted.
    restock: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


class Refund(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "refunds"
    __table_args__ = (CheckConstraint("amount > 0", name="amount_positive"),)

    return_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("returns.id", ondelete="CASCADE"), index=True
    )
    payment_method_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("payment_methods.id"))
    method_kind: Mapped[str] = mapped_column(String(16))
    amount: Mapped[Decimal] = mapped_column(Money)
    reference_no: Mapped[str | None] = mapped_column(String(100))
