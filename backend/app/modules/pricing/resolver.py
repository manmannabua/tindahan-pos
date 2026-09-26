"""Price resolution — pure logic, mirrored by the POS (`frontend/lib/pricing`).

Rules, in order:
1. Look in the requested price level; if it has no applicable price, fall back to the company's
   default level (e.g. a wholesale customer buying an item that only has a retail price).
2. Within a level, a branch-specific price beats a company-wide price.
3. Among the remaining prices, the highest `min_quantity` that is <= the quantity wins
   (quantity breaks: 1+ = 25.00, 12+ = 23.50).

No price for the unit → `None`. The unit price is never derived from another unit by
multiplying the factor, because case/box prices are usually discounted on purpose.
"""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class PriceCandidate:
    product_unit_id: uuid.UUID
    price_level_id: uuid.UUID
    branch_id: uuid.UUID | None
    min_quantity: Decimal
    price: Decimal


def resolve_price(
    candidates: Iterable[PriceCandidate],
    *,
    product_unit_id: uuid.UUID,
    price_level_id: uuid.UUID,
    default_price_level_id: uuid.UUID,
    branch_id: uuid.UUID | None,
    quantity: Decimal,
) -> PriceCandidate | None:
    pool = [c for c in candidates if c.product_unit_id == product_unit_id]
    levels = [price_level_id]
    if default_price_level_id != price_level_id:
        levels.append(default_price_level_id)

    for level in levels:
        in_level = [
            c
            for c in pool
            if c.price_level_id == level
            and c.min_quantity <= quantity
            and (c.branch_id is None or c.branch_id == branch_id)
        ]
        if not in_level:
            continue
        branch_specific = [c for c in in_level if c.branch_id is not None]
        chosen_from = branch_specific or in_level
        return max(chosen_from, key=lambda c: c.min_quantity)
    return None
