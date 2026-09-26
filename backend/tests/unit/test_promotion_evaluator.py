"""Promotion evaluation: hand-checked expectations + the shared cross-language vectors."""

import json
from pathlib import Path

from scripts.gen_promotion_vectors import build

VECTORS = Path(__file__).resolve().parents[3] / "shared" / "test-vectors" / "promotions.json"

# Lines: Cola 7 x 25.00 (gross 175.00), Chips 2 x 33.75 (67.50), Rice 2.5 x 52.50 (131.25).
HAND_CHECKED = {
    "percent off a category": [("1", "17.50")],  # 10% of 175.00, drinks only
    "amount off per unit, capped at the price": [("2", "67.50")],  # 40 > 33.75 → whole price
    "fixed price on a weighed item": [("3", "6.27")],  # 131.25 - round(124.975) = 131.25 - 124.98
    "buy 2 get 1 on the same line": [("1", "50.00")],  # 7 // 3 = 2 free x 25.00
    # Cola: brand promo (priority 10) wins over 50% off; others: 50% beats 20%.
    "priority beats bigger discount; best discount breaks priority ties": [
        ("1", "8.75"),
        ("2", "33.75"),
        ("3", "65.63"),
    ],
    "happy hour window and weekday filter": [("1", "26.25"), ("2", "10.13"), ("3", "19.69")],
    "overnight window, date range, branch and inactive filters": [
        ("1", "43.75"),
        ("2", "16.88"),
        ("3", "32.81"),
    ],
    # Cola has a manual discount; Chips (qty 2) is below min 2.5; Rice qualifies.
    "min quantity and manual discount win": [("3", "13.13")],
}


def test_hand_checked_expectations() -> None:
    data = build()
    for case in data["cases"]:
        got = [(a["line_id"], a["discount"]) for a in case["expected"]]
        assert got == HAND_CHECKED[case["name"]], case["name"]


def test_shared_vectors_are_current() -> None:
    """The JSON the POS tests against must equal what the Python evaluator produces now."""
    assert json.loads(VECTORS.read_text(encoding="utf-8")) == build()
