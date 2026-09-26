"""Regenerate shared/test-vectors/promotions.json from the Python evaluator.

uv run python scripts/gen_promotion_vectors.py
"""

import json
import uuid
from datetime import datetime, time
from decimal import Decimal
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from app.modules.promotions.evaluator import CartLine, PromoDef, evaluate

OUT = Path(__file__).resolve().parents[2] / "shared" / "test-vectors" / "promotions.json"
MANILA = ZoneInfo("Asia/Manila")

BRANCH = "00000000-0000-7000-8000-00000000b001"
OTHER_BRANCH = "00000000-0000-7000-8000-00000000b002"
COLA, CHIPS, RICE = (f"00000000-0000-7000-8000-0000000000{n}" for n in ("c1", "c2", "c3"))
P_COLA, P_CHIPS, P_RICE = (f"00000000-0000-7000-8000-0000000001{n}" for n in ("c1", "c2", "c3"))
DRINKS, SNACKS = "00000000-0000-7000-8000-0000000002d1", "00000000-0000-7000-8000-0000000002d2"
BRAND = "00000000-0000-7000-8000-0000000003b1"

LINES = [
    {
        "line_id": "1",
        "variant_id": COLA,
        "product_id": P_COLA,
        "category_id": DRINKS,
        "brand_id": BRAND,
        "quantity": "7",
        "unit_price": "25.00",
    },
    {
        "line_id": "2",
        "variant_id": CHIPS,
        "product_id": P_CHIPS,
        "category_id": SNACKS,
        "brand_id": None,
        "quantity": "2",
        "unit_price": "33.75",
    },
    {
        "line_id": "3",
        "variant_id": RICE,
        "product_id": P_RICE,
        "category_id": None,
        "brand_id": None,
        "quantity": "2.5",
        "unit_price": "52.50",
    },
]


def promo(
    n: int, kind: str, value: str, targets: list[dict[str, str]], **extra: Any
) -> dict[str, Any]:
    return {
        "id": f"00000000-0000-7000-8000-0000000009{n:02d}",
        "kind": kind,
        "value": value,
        "targets": targets,
        **extra,
    }


SATURDAY_5PM = "2026-09-26T17:00:00+08:00"  # a Saturday in Manila
MONDAY_9AM = "2026-09-28T09:00:00+08:00"

CASES: list[dict[str, Any]] = [
    {
        "name": "percent off a category",
        "now": MONDAY_9AM,
        "promotions": [promo(1, "PERCENT_OFF", "10", [{"type": "CATEGORY", "id": DRINKS}])],
    },
    {
        "name": "amount off per unit, capped at the price",
        "now": MONDAY_9AM,
        "promotions": [promo(2, "AMOUNT_OFF", "40", [{"type": "VARIANT", "id": CHIPS}])],
    },
    {
        "name": "fixed price on a weighed item",
        "now": MONDAY_9AM,
        "promotions": [promo(3, "FIXED_PRICE", "49.99", [{"type": "PRODUCT", "id": P_RICE}])],
    },
    {
        "name": "buy 2 get 1 on the same line",
        "now": MONDAY_9AM,
        "promotions": [
            promo(
                4,
                "BUY_X_GET_Y",
                "0",
                [{"type": "VARIANT", "id": COLA}],
                buy_quantity="2",
                get_quantity="1",
            )
        ],
    },
    {
        "name": "priority beats bigger discount; best discount breaks priority ties",
        "now": MONDAY_9AM,
        "promotions": [
            promo(5, "PERCENT_OFF", "50", [{"type": "ALL"}], priority=0),
            promo(6, "PERCENT_OFF", "5", [{"type": "BRAND", "id": BRAND}], priority=10),
            promo(7, "PERCENT_OFF", "20", [{"type": "ALL"}], priority=0),
        ],
    },
    {
        "name": "happy hour window and weekday filter",
        "now": SATURDAY_5PM,
        "promotions": [
            promo(
                8,
                "PERCENT_OFF",
                "15",
                [{"type": "ALL"}],
                days_of_week=[6, 7],
                start_time="16:00:00",
                end_time="19:00:00",
            ),
            promo(9, "PERCENT_OFF", "30", [{"type": "ALL"}], days_of_week=[1, 2, 3, 4, 5]),
        ],
    },
    {
        "name": "overnight window, date range, branch and inactive filters",
        "now": MONDAY_9AM,
        "promotions": [
            promo(
                10,
                "PERCENT_OFF",
                "25",
                [{"type": "ALL"}],
                start_time="22:00:00",
                end_time="10:00:00",
            ),
            promo(11, "PERCENT_OFF", "90", [{"type": "ALL"}], ends_at="2026-09-28T00:00:00+08:00"),
            promo(12, "PERCENT_OFF", "90", [{"type": "ALL"}], branch_ids=[OTHER_BRANCH]),
            promo(13, "PERCENT_OFF", "90", [{"type": "ALL"}], is_active=False),
        ],
    },
    {
        "name": "min quantity and manual discount win",
        "now": MONDAY_9AM,
        "manual_discount_lines": ["1"],
        "promotions": [
            promo(14, "PERCENT_OFF", "10", [{"type": "ALL"}], min_quantity="2.5"),
        ],
    },
]


def _promo(raw: dict[str, Any]) -> PromoDef:
    def dt(value: str | None) -> datetime | None:
        return datetime.fromisoformat(value) if value else None

    def tm(value: str | None) -> time | None:
        return time.fromisoformat(value) if value else None

    return PromoDef(
        id=uuid.UUID(raw["id"]),
        kind=raw["kind"],
        value=Decimal(raw["value"]),
        targets=raw["targets"],
        min_quantity=Decimal(raw.get("min_quantity", "1")),
        buy_quantity=Decimal(raw["buy_quantity"]) if raw.get("buy_quantity") else None,
        get_quantity=Decimal(raw["get_quantity"]) if raw.get("get_quantity") else None,
        starts_at=dt(raw.get("starts_at")),
        ends_at=dt(raw.get("ends_at")),
        days_of_week=raw.get("days_of_week"),
        start_time=tm(raw.get("start_time")),
        end_time=tm(raw.get("end_time")),
        branch_ids=[uuid.UUID(b) for b in raw["branch_ids"]] if raw.get("branch_ids") else None,
        priority=raw.get("priority", 0),
        is_active=raw.get("is_active", True),
    )


def _lines(manual: list[str]) -> list[CartLine]:
    return [
        CartLine(
            line_id=raw["line_id"],
            variant_id=uuid.UUID(raw["variant_id"]),
            product_id=uuid.UUID(raw["product_id"]),
            category_id=uuid.UUID(raw["category_id"]) if raw["category_id"] else None,
            brand_id=uuid.UUID(raw["brand_id"]) if raw["brand_id"] else None,
            quantity=Decimal(raw["quantity"]),
            unit_price=Decimal(raw["unit_price"]),
            has_manual_discount=raw["line_id"] in manual,
        )
        for raw in LINES
    ]


def build() -> dict[str, Any]:
    cases = []
    for case in CASES:
        applied = evaluate(
            _lines(case.get("manual_discount_lines", [])),
            [_promo(p) for p in case["promotions"]],
            now=datetime.fromisoformat(case["now"]).astimezone(MANILA),
            branch_id=uuid.UUID(BRANCH),
        )
        cases.append(
            {
                **case,
                "expected": [
                    {
                        "line_id": a.line_id,
                        "promotion_id": str(a.promotion_id),
                        "discount": str(a.discount),
                    }
                    for a in applied
                ],
            }
        )
    return {
        "description": "Generated by backend/scripts/gen_promotion_vectors.py. Do not edit by hand.",
        "branch_id": BRANCH,
        "lines": LINES,
        "cases": cases,
    }


if __name__ == "__main__":
    OUT.write_text(json.dumps(build(), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}")
