"""Sale arithmetic. Hand-checked cases + the shared cross-language vectors."""

import json
from decimal import Decimal
from pathlib import Path

import pytest

from app.modules.sales.calculation import (
    CalculationError,
    Discount,
    DiscountKind,
    LineInput,
    PaymentInput,
    allocate,
    calculate_sale,
    settle_payments,
)

VECTORS = Path(__file__).resolve().parents[3] / "shared" / "test-vectors" / "sale_calculation.json"
D = Decimal


def test_vat_inclusive_hand_checked() -> None:
    # 2 x 25.00 = 50.00 incl. 12% VAT → VAT = 50 x 12/112 = 5.357… → 5.36
    result = calculate_sale([LineInput(D("2"), D("25.00"), D("12"))], prices_include_tax=True)
    assert result.totals.total == D("50.00")
    assert result.totals.tax_total == D("5.36")
    assert result.totals.vatable_sales == D("44.64")


def test_vat_exclusive_hand_checked() -> None:
    # 3 x 19.99 = 59.97; VAT 7.1964 → 7.20; total 67.17
    result = calculate_sale([LineInput(D("3"), D("19.99"), D("12"))], prices_include_tax=False)
    assert result.totals.tax_total == D("7.20")
    assert result.totals.total == D("67.17")


def test_half_up_not_bankers_rounding() -> None:
    # 0.5 x 0.25 = 0.125 → 0.13 (banker's rounding would give 0.12)
    result = calculate_sale(
        [LineInput(D("0.5"), D("0.25"), D("0"), "EXEMPT")], prices_include_tax=True
    )
    assert result.totals.total == D("0.13")


def test_senior_citizen_hand_checked() -> None:
    # 112.00 incl. 12% VAT → VAT-exclusive 100.00 → 20% = 20.00 → pays 80.00, VAT-exempt
    result = calculate_sale(
        [LineInput(D("1"), D("112.00"), D("12"), statutory=True)], prices_include_tax=True
    )
    line = result.lines[0]
    assert (line.vat_exemption, line.statutory_discount, line.total) == (
        D("12.00"),
        D("20.00"),
        D("80.00"),
    )
    assert result.totals.tax_total == D("0.00")
    assert result.totals.exempt_sales == D("80.00")
    # 3 x 33.33 = 99.99 → base round(89.276...) = 89.28, VAT 10.71, 20% = 17.86 → 71.42
    rounding = calculate_sale(
        [LineInput(D("3"), D("33.33"), D("12"), statutory=True)], prices_include_tax=True
    )
    assert rounding.totals.total == D("71.42")
    assert rounding.totals.vat_exemption_total == D("10.71")


def test_senior_citizen_line_excluded_from_order_discount() -> None:
    result = calculate_sale(
        [
            LineInput(D("2"), D("56.00"), D("12"), statutory=True),
            LineInput(D("1"), D("50.00"), D("12")),
        ],
        prices_include_tax=True,
        order_discount=Discount(DiscountKind.PERCENT, D("10")),
    )
    assert result.totals.order_discount_total == D("5.00")  # 10% of the regular line only
    assert result.lines[0].order_discount_share == D("0.00")
    assert result.totals.total == D("125.00")  # 80.00 + 45.00


def test_allocation_sums_exactly() -> None:
    assert allocate(D("10.00"), [D("10"), D("10"), D("10")]) == [D("3.34"), D("3.33"), D("3.33")]
    assert allocate(D("5.00"), [D("0"), D("0")]) == [D("0.00"), D("0.00")]


def test_discount_validation() -> None:
    with pytest.raises(CalculationError):
        calculate_sale(
            [LineInput(D(1), D("10.00"), D(12), discount=Discount(DiscountKind.AMOUNT, D("11")))],
            prices_include_tax=True,
        )
    with pytest.raises(CalculationError):
        calculate_sale(
            [LineInput(D(1), D("10.00"), D(12))],
            prices_include_tax=True,
            order_discount=Discount(DiscountKind.PERCENT, D("101")),
        )


def test_split_payment_change() -> None:
    summary = settle_payments(
        D("67.17"),
        [PaymentInput("EWALLET", D("50.00")), PaymentInput("CASH", D("17.17"), D("20.00"))],
    )
    assert summary.paid_total == D("67.17")
    assert summary.change_total == D("2.83")


def _discount(raw: dict[str, str] | None) -> Discount | None:
    return Discount(DiscountKind(raw["kind"]), D(raw["value"])) if raw else None


def test_shared_vectors_match_python() -> None:
    """The same file is executed by the frontend (Vitest). Both must match it exactly."""
    data = json.loads(VECTORS.read_text(encoding="utf-8"))
    assert data["sales"], "vectors file is empty"
    for case in data["sales"]:
        result = calculate_sale(
            [
                LineInput(
                    D(line["quantity"]),
                    D(line["unit_price"]),
                    D(line["tax_rate"]),
                    line.get("tax_kind", "VATABLE"),
                    _discount(line.get("discount")),
                    line.get("statutory", False),
                )
                for line in case["lines"]
            ],
            prices_include_tax=case["prices_include_tax"],
            order_discount=_discount(case.get("order_discount")),
        )
        for got, want in zip(result.lines, case["expected"]["lines"], strict=True):
            assert {k: str(getattr(got, k)) for k in want} == want, case["name"]
        assert {k: str(getattr(result.totals, k)) for k in case["expected"]["totals"]} == case[
            "expected"
        ]["totals"], case["name"]

    for case in data["payments"]:
        payments = [
            PaymentInput(
                p["method_kind"], D(p["amount"]), D(p["tendered"]) if "tendered" in p else None
            )
            for p in case["payments"]
        ]
        if case.get("error"):
            with pytest.raises(CalculationError):
                settle_payments(D(case["total"]), payments)
        else:
            summary = settle_payments(D(case["total"]), payments)
            assert str(summary.paid_total) == case["expected"]["paid_total"]
            assert str(summary.change_total) == case["expected"]["change_total"]
