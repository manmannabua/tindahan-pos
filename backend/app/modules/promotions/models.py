"""Promotions (Phase 7).

Promotions are *evaluated on the terminal* (they must work offline) and applied as line
discounts that reference the promotion. The server stores the definitions, syncs them to
terminals and verifies the resulting arithmetic like any other discount.

Targets are stored on the promotion row itself (JSONB), not in a child table: a promotion is
always edited and synced as one unit, and removing a target must reach offline terminals as an
update (a deleted child row would silently never arrive).
"""

import uuid
from datetime import datetime, time
from decimal import Decimal
from enum import StrEnum
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, Integer, String, Time, Uuid, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import (
    Base,
    CompanyScopedMixin,
    Money,
    Quantity,
    SyncTrackedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    sync_index,
)


class PromotionKind(StrEnum):
    PERCENT_OFF = "PERCENT_OFF"  # value = percent off the line
    AMOUNT_OFF = "AMOUNT_OFF"  # value = amount off per unit
    FIXED_PRICE = "FIXED_PRICE"  # value = special unit price
    BUY_X_GET_Y = "BUY_X_GET_Y"  # for every buy+get units, `get` units are free


class TargetType(StrEnum):
    VARIANT = "VARIANT"
    PRODUCT = "PRODUCT"
    CATEGORY = "CATEGORY"
    BRAND = "BRAND"
    ALL = "ALL"


class Promotion(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    __tablename__ = "promotions"
    __table_args__ = (
        CheckConstraint(
            "kind IN ('PERCENT_OFF', 'AMOUNT_OFF', 'FIXED_PRICE', 'BUY_X_GET_Y')", name="kind"
        ),
        CheckConstraint("value >= 0", name="value_non_negative"),
        CheckConstraint(
            "kind <> 'BUY_X_GET_Y' OR (buy_quantity > 0 AND get_quantity > 0)",
            name="bxgy_quantities",
        ),
        sync_index("promotions"),
    )

    name: Mapped[str] = mapped_column(String(200))
    kind: Mapped[PromotionKind] = mapped_column(String(16))
    value: Mapped[Decimal] = mapped_column(Money, server_default=text("0"))
    buy_quantity: Mapped[Decimal | None] = mapped_column(Quantity)
    get_quantity: Mapped[Decimal | None] = mapped_column(Quantity)
    min_quantity: Mapped[Decimal] = mapped_column(Quantity, server_default=text("1"))
    # [{"type": "CATEGORY", "id": "..."}, ...]; [{"type": "ALL"}] for everything.
    targets: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, server_default=text("'[]'::jsonb"))
    starts_at: Mapped[datetime | None]
    ends_at: Mapped[datetime | None]
    # ISO weekdays 1 (Mon) .. 7 (Sun); NULL = every day.
    days_of_week: Mapped[list[int] | None] = mapped_column(ARRAY(Integer))
    start_time: Mapped[time | None] = mapped_column(Time)  # local time, e.g. happy hour
    end_time: Mapped[time | None] = mapped_column(Time)
    # NULL = all branches.
    branch_ids: Mapped[list[uuid.UUID] | None] = mapped_column(ARRAY(Uuid))
    # Higher wins when several promotions apply to the same line (they don't stack).
    priority: Mapped[int] = mapped_column(Integer, server_default=text("0"))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
