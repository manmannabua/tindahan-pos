"""Promotion evaluation — a contract shared with the POS (`frontend/lib/promotions`).

Promotions must work offline, so the terminal evaluates them; this module is the reference
implementation, verified by `shared/test-vectors/promotions.json` on both sides.

Rules:
1. A promotion is *eligible* at `now` (local time of the branch) if it is active, within
   [starts_at, ends_at), on one of `days_of_week` (ISO 1=Mon..7=Sun), inside the daily
   [start_time, end_time) window (a window ending before it starts spans midnight), and
   `branch_ids` is empty or contains the branch.
2. It *targets* a line if any target matches: ALL, or VARIANT/PRODUCT/CATEGORY/BRAND id equal to
   the line's. The line quantity must be >= `min_quantity`.
3. Per line at most one promotion applies (no stacking): highest `priority`, then the largest
   discount, then the smallest id (deterministic).
4. Discount per line (money rounded HALF_UP to 2 decimals), never more than the line's gross:
   PERCENT_OFF  round(gross x value / 100)
   AMOUNT_OFF   round(min(value, unit_price) x quantity)
   FIXED_PRICE  max(0, gross - round(value x quantity))
   BUY_X_GET_Y  round(free_units x unit_price), free_units = floor(qty / (buy + get)) x get
                (same line only: mixed-item bundles are not supported)
5. A line with a manual discount is left alone (the cashier's decision wins).

The result is applied as a line discount of kind AMOUNT carrying `promotion_id`, so the
server verifies it with the normal sale arithmetic.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime, time
from decimal import ROUND_FLOOR, ROUND_HALF_UP, Decimal
from typing import Any

CENT = Decimal("0.01")


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True, slots=True)
class PromoDef:
    id: uuid.UUID
    kind: str
    value: Decimal
    targets: list[dict[str, Any]]
    min_quantity: Decimal = Decimal(1)
    buy_quantity: Decimal | None = None
    get_quantity: Decimal | None = None
    starts_at: datetime | None = None
    ends_at: datetime | None = None
    days_of_week: list[int] | None = None
    start_time: time | None = None
    end_time: time | None = None
    branch_ids: list[uuid.UUID] | None = None
    priority: int = 0
    is_active: bool = True


@dataclass(frozen=True, slots=True)
class CartLine:
    line_id: str
    variant_id: uuid.UUID
    product_id: uuid.UUID
    quantity: Decimal
    unit_price: Decimal
    category_id: uuid.UUID | None = None
    brand_id: uuid.UUID | None = None
    has_manual_discount: bool = False


@dataclass(frozen=True, slots=True)
class AppliedPromotion:
    line_id: str
    promotion_id: uuid.UUID
    discount: Decimal


@dataclass(slots=True)
class _Candidate:
    promo: PromoDef
    discount: Decimal = field(default=Decimal(0))


def is_eligible(promo: PromoDef, now: datetime, branch_id: uuid.UUID) -> bool:
    """`now` must be timezone-aware local time of the branch."""
    if not promo.is_active:
        return False
    if promo.starts_at and now < promo.starts_at:
        return False
    if promo.ends_at and now >= promo.ends_at:
        return False
    if promo.days_of_week and now.isoweekday() not in promo.days_of_week:
        return False
    if promo.start_time is not None and promo.end_time is not None:
        t = now.timetz().replace(tzinfo=None)
        start, end = promo.start_time, promo.end_time
        inside = start <= t < end if start <= end else (t >= start or t < end)
        if not inside:
            return False
    return not promo.branch_ids or branch_id in promo.branch_ids


def targets(promo: PromoDef, line: CartLine) -> bool:
    ids = {
        "VARIANT": line.variant_id,
        "PRODUCT": line.product_id,
        "CATEGORY": line.category_id,
        "BRAND": line.brand_id,
    }
    for target in promo.targets:
        kind = target.get("type")
        if kind == "ALL":
            return True
        if kind in ids and ids[kind] is not None and str(ids[kind]) == str(target.get("id")):
            return True
    return False


def line_discount(promo: PromoDef, line: CartLine) -> Decimal:
    gross = _money(line.unit_price * line.quantity)
    if promo.kind == "PERCENT_OFF":
        amount = _money(gross * promo.value / 100)
    elif promo.kind == "AMOUNT_OFF":
        amount = _money(min(promo.value, line.unit_price) * line.quantity)
    elif promo.kind == "FIXED_PRICE":
        amount = max(Decimal(0), gross - _money(promo.value * line.quantity))
    elif promo.kind == "BUY_X_GET_Y":
        buy, get = promo.buy_quantity or Decimal(0), promo.get_quantity or Decimal(0)
        if buy <= 0 or get <= 0:
            return Decimal("0.00")
        bundles = (line.quantity / (buy + get)).to_integral_value(rounding=ROUND_FLOOR)
        amount = _money(bundles * get * line.unit_price)
    else:
        return Decimal("0.00")
    return min(amount, gross)


def evaluate(
    lines: Sequence[CartLine],
    promotions: Sequence[PromoDef],
    *,
    now: datetime,
    branch_id: uuid.UUID,
) -> list[AppliedPromotion]:
    eligible = [p for p in promotions if is_eligible(p, now, branch_id)]
    applied: list[AppliedPromotion] = []
    for line in lines:
        if line.has_manual_discount:
            continue
        candidates = [
            _Candidate(p, line_discount(p, line))
            for p in eligible
            if targets(p, line) and line.quantity >= p.min_quantity
        ]
        candidates = [c for c in candidates if c.discount > 0]
        if not candidates:
            continue
        best = min(candidates, key=lambda c: (-c.promo.priority, -c.discount, str(c.promo.id)))
        applied.append(AppliedPromotion(line.line_id, best.promo.id, best.discount))
    return applied
