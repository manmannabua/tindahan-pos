"""Receipt journal: an exact copy of every receipt a terminal issued, and every time it printed.

Both tables are append-only (database trigger): a receipt is stored as it was issued — the laid
out lines, not re-rendered from today's data — so later changes to the company name, prices or
the receipt template can never alter what the customer was given. Print counts are derived
from `receipt_prints`. This doubles as the electronic journal BIR expects from a POS.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import Base, CompanyScopedMixin, UUIDPrimaryKeyMixin


class ReceiptKind(StrEnum):
    SALE = "SALE"
    RETURN = "RETURN"


class PrintMethod(StrEnum):
    ESCPOS = "ESCPOS"  # sent straight to the thermal printer: confirmed
    BROWSER = "BROWSER"  # handed to the browser print dialog: can't confirm it came out


class Receipt(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "receipts"
    __table_args__ = (
        UniqueConstraint("device_id", "kind", "number"),
        Index("ix_receipts_company_issued", "company_id", "issued_at"),
        CheckConstraint("width IN (58, 80)", name="width_valid"),
        CheckConstraint(
            "(kind = 'SALE' AND sale_id IS NOT NULL)"
            " OR (kind = 'RETURN' AND return_id IS NOT NULL)",
            name="kind_reference",
        ),
    )

    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"))
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id"), index=True)
    kind: Mapped[ReceiptKind] = mapped_column(String(16))
    number: Mapped[str] = mapped_column(String(40))
    sale_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("sales.id"), index=True)
    return_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("returns.id"), index=True)
    issued_at: Mapped[datetime]
    width: Mapped[int] = mapped_column(SmallInteger)
    # ReceiptLine[] exactly as laid out on the terminal (frontend lib/printing/receipt.ts).
    lines: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    total: Mapped[Decimal]
    cashier_name: Mapped[str] = mapped_column(String(200))
    # Rebuilt later from the stored sale (sales made before the journal existed).
    reconstructed: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())


class ReceiptPrint(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "receipt_prints"

    receipt_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("receipts.id"), index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id"))
    printed_at: Mapped[datetime]
    method: Mapped[PrintMethod] = mapped_column(String(16))
    is_reprint: Mapped[bool] = mapped_column(Boolean)
    # Why the thermal printer wasn't used (the browser printed instead).
    fallback_reason: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
