"""Cash drawer sessions (shifts) and cash movements. Both are created on the POS (offline)."""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import CheckConstraint, ForeignKey, Index, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import (
    Base,
    CompanyScopedMixin,
    Money,
    SyncTrackedMixin,
    UUIDPrimaryKeyMixin,
    sync_index,
)


class CashSessionStatus(StrEnum):
    OPEN = "OPEN"
    CLOSED = "CLOSED"


class CashSession(UUIDPrimaryKeyMixin, CompanyScopedMixin, SyncTrackedMixin, Base):
    __tablename__ = "cash_sessions"
    __table_args__ = (
        CheckConstraint("status IN ('OPEN', 'CLOSED')", name="status"),
        CheckConstraint("opening_float >= 0", name="opening_float_non_negative"),
        Index("ix_cash_sessions_device_opened", "device_id", "opened_at"),
        sync_index("cash_sessions"),
    )

    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id"))
    opened_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    opened_at: Mapped[datetime]
    opening_float: Mapped[Decimal] = mapped_column(Money)
    status: Mapped[CashSessionStatus] = mapped_column(
        String(16), server_default=CashSessionStatus.OPEN.value
    )
    closed_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    closed_at: Mapped[datetime | None]
    # Values reported by the terminal at close (what the cashier saw and signed off).
    counted_cash: Mapped[Decimal | None] = mapped_column(Money)
    expected_cash: Mapped[Decimal | None] = mapped_column(Money)
    over_short: Mapped[Decimal | None] = mapped_column(Money)
    # Expected cash recomputed by the server from synced data at close time.
    server_expected_cash: Mapped[Decimal | None] = mapped_column(Money)
    closing_note: Mapped[str | None] = mapped_column(String(500))
    received_at: Mapped[datetime] = mapped_column(server_default=func.now())


class CashMovementType(StrEnum):
    CASH_IN = "CASH_IN"  # adding change/float
    CASH_OUT = "CASH_OUT"  # paying something from the drawer
    PICKUP = "PICKUP"  # removing excess cash to the safe


CASH_MOVEMENT_SIGN: dict[CashMovementType, int] = {
    CashMovementType.CASH_IN: 1,
    CashMovementType.CASH_OUT: -1,
    CashMovementType.PICKUP: -1,
}


class CashMovement(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "cash_movements"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint("movement_type IN ('CASH_IN', 'CASH_OUT', 'PICKUP')", name="movement_type"),
    )

    cash_session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("cash_sessions.id"), index=True)
    movement_type: Mapped[CashMovementType] = mapped_column(String(16))
    amount: Mapped[Decimal] = mapped_column(Money)
    reason: Mapped[str | None] = mapped_column(String(300))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    authorized_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    occurred_at: Mapped[datetime]
    received_at: Mapped[datetime] = mapped_column(server_default=text("now()"))
