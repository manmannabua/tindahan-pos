"""Sales. Created on POS terminals (offline-origin): `id` values are client UUIDs.

Item rows snapshot names, prices, tax and cost, because a receipt must never change when the
catalog changes later.
"""

import uuid
from datetime import datetime
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
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.modules.payments.models import Payment
from app.modules.products.models import UnitFactor
from app.shared.models import (
    Base,
    CompanyScopedMixin,
    Money,
    Quantity,
    Rate,
    SyncTrackedMixin,
    UnitCost,
    UUIDPrimaryKeyMixin,
    sync_index,
)


class SaleStatus(StrEnum):
    COMPLETED = "COMPLETED"
    VOIDED = "VOIDED"


class Sale(UUIDPrimaryKeyMixin, CompanyScopedMixin, SyncTrackedMixin, Base):
    __tablename__ = "sales"
    __table_args__ = (
        # Receipt numbers are generated per device, so uniqueness is per device.
        UniqueConstraint("device_id", "receipt_number"),
        Index("ix_sales_company_occurred", "company_id", text("occurred_at DESC")),
        Index("ix_sales_branch_occurred", "branch_id", "occurred_at"),
        Index("ix_sales_receipt_number", "company_id", "receipt_number"),
        CheckConstraint("status IN ('COMPLETED', 'VOIDED')", name="status"),
        CheckConstraint("total >= 0", name="total_non_negative"),
        sync_index("sales"),
    )

    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"))
    stock_location_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("stock_locations.id"))
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id"))
    cash_session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("cash_sessions.id"), index=True
    )
    receipt_number: Mapped[str] = mapped_column(String(40))
    cashier_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("customers.id"), index=True)
    price_level_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("price_levels.id"))
    status: Mapped[SaleStatus] = mapped_column(String(16), server_default="COMPLETED")
    prices_include_tax: Mapped[bool] = mapped_column(Boolean)

    gross_total: Mapped[Decimal] = mapped_column(Money)
    line_discount_total: Mapped[Decimal] = mapped_column(Money)
    order_discount_total: Mapped[Decimal] = mapped_column(Money)
    discount_total: Mapped[Decimal] = mapped_column(Money)
    tax_total: Mapped[Decimal] = mapped_column(Money)
    total: Mapped[Decimal] = mapped_column(Money)
    paid_total: Mapped[Decimal] = mapped_column(Money)
    change_total: Mapped[Decimal] = mapped_column(Money)
    vatable_sales: Mapped[Decimal] = mapped_column(Money)
    vat_amount: Mapped[Decimal] = mapped_column(Money)
    exempt_sales: Mapped[Decimal] = mapped_column(Money)
    zero_rated_sales: Mapped[Decimal] = mapped_column(Money)

    # Senior citizen / PWD (RA 9994 / RA 10754): holder details are required on the receipt and
    # in the BIR senior citizen / PWD sales book.
    statutory_kind: Mapped[str | None] = mapped_column(String(8))  # SENIOR | PWD
    statutory_id_number: Mapped[str | None] = mapped_column(String(64))
    statutory_holder_name: Mapped[str | None] = mapped_column(String(200))
    statutory_holder_tin: Mapped[str | None] = mapped_column(String(32))
    vat_exemption_total: Mapped[Decimal] = mapped_column(Money, server_default=text("0"))
    statutory_discount_total: Mapped[Decimal] = mapped_column(Money, server_default=text("0"))

    order_discount_kind: Mapped[str | None] = mapped_column(String(16))
    order_discount_value: Mapped[Decimal | None] = mapped_column(Money)
    order_discount_reason: Mapped[str | None] = mapped_column(String(200))
    order_discount_authorized_by_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id")
    )
    notes: Mapped[str | None] = mapped_column(String(500))

    occurred_at: Mapped[datetime]  # device clock
    received_at: Mapped[datetime] = mapped_column(server_default=func.now())
    # True if the server's recomputation disagreed with the terminal's totals (flag raised).
    totals_mismatch: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))

    voided_at: Mapped[datetime | None]
    voided_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    void_authorized_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    void_reason: Mapped[str | None] = mapped_column(String(300))

    items: Mapped[list["SaleItem"]] = relationship(lazy="raise", order_by="SaleItem.line_no")
    payments: Mapped[list[Payment]] = relationship(lazy="raise", order_by=Payment.occurred_at)


class SaleItem(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "sale_items"
    __table_args__ = (
        UniqueConstraint("sale_id", "line_no"),
        CheckConstraint("quantity > 0", name="quantity_positive"),
        Index("ix_sale_items_variant", "variant_id"),
    )

    sale_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sales.id", ondelete="RESTRICT"))
    line_no: Mapped[int] = mapped_column(Integer)
    product_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("products.id"))
    variant_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_variants.id"))
    product_unit_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("product_units.id"))
    unit_factor: Mapped[Decimal] = mapped_column(UnitFactor)
    unit_code: Mapped[str] = mapped_column(String(16))
    product_name: Mapped[str] = mapped_column(String(200))
    variant_name: Mapped[str | None] = mapped_column(String(200))
    sku: Mapped[str] = mapped_column(String(64))
    barcode: Mapped[str | None] = mapped_column(String(64))

    quantity: Mapped[Decimal] = mapped_column(Quantity)
    base_quantity: Mapped[Decimal] = mapped_column(Quantity)
    unit_price: Mapped[Decimal] = mapped_column(Money)
    original_unit_price: Mapped[Decimal | None] = mapped_column(Money)
    price_overridden_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))

    discount_kind: Mapped[str | None] = mapped_column(String(16))
    discount_value: Mapped[Decimal | None] = mapped_column(Money)
    discount_reason: Mapped[str | None] = mapped_column(String(200))
    discount_authorized_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    promotion_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("promotions.id"))
    statutory: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    vat_exemption: Mapped[Decimal] = mapped_column(Money, server_default=text("0"))
    statutory_discount: Mapped[Decimal] = mapped_column(Money, server_default=text("0"))

    gross: Mapped[Decimal] = mapped_column(Money)
    line_discount: Mapped[Decimal] = mapped_column(Money)
    order_discount_share: Mapped[Decimal] = mapped_column(Money)
    net: Mapped[Decimal] = mapped_column(Money)
    tax_rate_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("tax_rates.id"))
    tax_rate: Mapped[Decimal] = mapped_column(Rate)
    tax_kind: Mapped[str] = mapped_column(String(16))
    tax_amount: Mapped[Decimal] = mapped_column(Money)
    total: Mapped[Decimal] = mapped_column(Money)
    # Average cost per base unit when the sale reached the server (COGS = base_qty x unit_cost).
    unit_cost: Mapped[Decimal] = mapped_column(UnitCost)
