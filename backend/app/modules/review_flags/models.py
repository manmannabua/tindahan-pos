"""Review flags: anomalies a manager must look at.

The system records what happened (a sale that oversold stock, totals that don't match) and
raises a flag instead of rejecting financial facts. See docs/SYNC_PROTOCOL.md §6.
"""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import Base, CompanyScopedMixin, UUIDPrimaryKeyMixin


class FlagType(StrEnum):
    NEGATIVE_INVENTORY = "NEGATIVE_INVENTORY"
    TOTAL_MISMATCH = "TOTAL_MISMATCH"
    CASH_SESSION_MISMATCH = "CASH_SESSION_MISMATCH"
    USER_NOT_AUTHORIZED = "USER_NOT_AUTHORIZED"
    PRICE_MISMATCH = "PRICE_MISMATCH"
    CLOCK_SKEW = "CLOCK_SKEW"
    BALANCE_DRIFT = "BALANCE_DRIFT"
    TRANSFER_DISCREPANCY = "TRANSFER_DISCREPANCY"
    DUPLICATE_CUSTOMER = "DUPLICATE_CUSTOMER"


class FlagStatus(StrEnum):
    OPEN = "OPEN"
    RESOLVED = "RESOLVED"
    DISMISSED = "DISMISSED"


class ReviewFlag(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "review_flags"
    __table_args__ = (
        CheckConstraint("status IN ('OPEN', 'RESOLVED', 'DISMISSED')", name="status"),
        # At most one OPEN flag per subject; repeat occurrences increment `occurrences`.
        Index(
            "uq_review_flags_open_subject",
            "company_id",
            "flag_type",
            "entity_type",
            "entity_id",
            "stock_location_id",
            unique=True,
            postgresql_where=text("status = 'OPEN'"),
            postgresql_nulls_not_distinct=True,
        ),
        Index("ix_review_flags_company_status", "company_id", "status"),
    )

    flag_type: Mapped[FlagType] = mapped_column(String(32))
    branch_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("branches.id"))
    stock_location_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("stock_locations.id"))
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[str] = mapped_column(String(64))
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    occurrences: Mapped[int] = mapped_column(Integer, server_default=text("1"))
    status: Mapped[FlagStatus] = mapped_column(String(16), server_default=FlagStatus.OPEN.value)
    first_seen_at: Mapped[datetime] = mapped_column(server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(server_default=func.now())
    resolved_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
    resolved_at: Mapped[datetime | None]
    resolution_note: Mapped[str | None] = mapped_column(String(500))
