"""Regenerate shared/test-vectors/sale_calculation.json from the Python implementation.

Run only when the calculation algorithm intentionally changes:
    uv run python scripts/gen_sale_vectors.py

Then run pytest (hand-checked cases) and the frontend Vitest suite, which must agree.
"""

import json
from decimal import Decimal
from pathlib import Path
from typing import Any

from app.modules.sales.calculation import (
    Discount,
    DiscountKind,
    LineInput,
    PaymentInput,
    calculate_sale,
    settle_payments,
)

OUT = Path(__file__).resolve().parents[2] / "shared" / "test-vectors" / "sale_calculation.json"

CASES: list[dict[str, Any]] = [
    {
        "name": "vat-inclusive single line",
        "prices_include_tax": True,
        "lines": [{"quantity": "2", "unit_price": "25.00", "tax_rate": "12"}],
    },
    {
        "name": "vat-exclusive single line",
        "prices_include_tax": False,
        "lines": [{"quantity": "3", "unit_price": "19.99", "tax_rate": "12"}],
    },
    {
        "name": "line percent discount",
        "prices_include_tax": True,
        "lines": [
            {
                "quantity": "1",
                "unit_price": "99.99",
                "tax_rate": "12",
                "discount": {"kind": "PERCENT", "value": "10"},
            }
        ],
    },
    {
        "name": "order amount discount across mixed tax kinds",
        "prices_include_tax": True,
        "order_discount": {"kind": "AMOUNT", "value": "10.00"},
        "lines": [
            {"quantity": "1", "unit_price": "50.00", "tax_rate": "12"},
            {"quantity": "1", "unit_price": "30.00", "tax_rate": "0", "tax_kind": "EXEMPT"},
            {"quantity": "1", "unit_price": "20.00", "tax_rate": "0", "tax_kind": "ZERO_RATED"},
        ],
    },
    {
        "name": "allocation remainder goes to first largest line",
        "prices_include_tax": True,
        "order_discount": {"kind": "AMOUNT", "value": "10.00"},
        "lines": [
            {"quantity": "1", "unit_price": "10.00", "tax_rate": "12"},
            {"quantity": "1", "unit_price": "10.00", "tax_rate": "12"},
            {"quantity": "1", "unit_price": "10.00", "tax_rate": "12"},
        ],
    },
    {
        "name": "weighed item fractional quantity",
        "prices_include_tax": True,
        "lines": [{"quantity": "0.375", "unit_price": "180.00", "tax_rate": "12"}],
    },
    {
        "name": "half-up rounding (not banker's)",
        "prices_include_tax": True,
        "lines": [{"quantity": "0.5", "unit_price": "0.25", "tax_rate": "0", "tax_kind": "EXEMPT"}],
    },
    {
        "name": "order percent discount, exclusive tax, mixed rates",
        "prices_include_tax": False,
        "order_discount": {"kind": "PERCENT", "value": "5"},
        "lines": [
            {"quantity": "4", "unit_price": "12.75", "tax_rate": "12"},
            {"quantity": "1", "unit_price": "249.00", "tax_rate": "12"},
            {"quantity": "2", "unit_price": "33.33", "tax_rate": "0", "tax_kind": "EXEMPT"},
        ],
    },
    {
        "name": "line amount discount plus order discount",
        "prices_include_tax": True,
        "order_discount": {"kind": "PERCENT", "value": "10"},
        "lines": [
            {
                "quantity": "2",
                "unit_price": "45.50",
                "tax_rate": "12",
                "discount": {"kind": "AMOUNT", "value": "5.00"},
            },
            {"quantity": "1", "unit_price": "18.25", "tax_rate": "12"},
        ],
    },
    {
        "name": "many small lines",
        "prices_include_tax": True,
        "order_discount": {"kind": "AMOUNT", "value": "1.00"},
        "lines": [
            {"quantity": "1", "unit_price": "0.33", "tax_rate": "12"},
            {"quantity": "1", "unit_price": "0.33", "tax_rate": "12"},
            {"quantity": "1", "unit_price": "0.34", "tax_rate": "12"},
            {"quantity": "7", "unit_price": "1.11", "tax_rate": "12"},
        ],
    },
]

# Senior citizen / PWD (RA 9994 / RA 10754): VAT exemption + 20% on the VAT-exclusive price.
CASES += [
    {
        "name": "senior citizen, VAT-inclusive item",
        "prices_include_tax": True,
        "lines": [{"quantity": "1", "unit_price": "112.00", "tax_rate": "12", "statutory": True}],
    },
    {
        "name": "senior citizen line mixed with a regular line and an order discount",
        "prices_include_tax": True,
        "order_discount": {"kind": "PERCENT", "value": "10"},
        "lines": [
            {"quantity": "2", "unit_price": "56.00", "tax_rate": "12", "statutory": True},
            {"quantity": "1", "unit_price": "50.00", "tax_rate": "12"},
        ],
    },
    {
        "name": "PWD on a VAT-exempt item",
        "prices_include_tax": True,
        "lines": [
            {
                "quantity": "1",
                "unit_price": "100.00",
                "tax_rate": "0",
                "tax_kind": "EXEMPT",
                "statutory": True,
            }
        ],
    },
    {
        "name": "statutory line ignores a manual discount",
        "prices_include_tax": True,
        "lines": [
            {
                "quantity": "1",
                "unit_price": "112.00",
                "tax_rate": "12",
                "statutory": True,
                "discount": {"kind": "PERCENT", "value": "50"},
            }
        ],
    },
    {
        "name": "senior citizen with VAT-exclusive prices",
        "prices_include_tax": False,
        "lines": [{"quantity": "1", "unit_price": "100.00", "tax_rate": "12", "statutory": True}],
    },
    {
        "name": "senior citizen rounding",
        "prices_include_tax": True,
        "lines": [{"quantity": "3", "unit_price": "33.33", "tax_rate": "12", "statutory": True}],
    },
]

PAYMENT_CASES: list[dict[str, Any]] = [
    {
        "name": "exact cash",
        "total": "50.00",
        "payments": [{"method_kind": "CASH", "amount": "50.00", "tendered": "50.00"}],
    },
    {
        "name": "cash with change",
        "total": "67.17",
        "payments": [{"method_kind": "CASH", "amount": "67.17", "tendered": "100.00"}],
    },
    {
        "name": "split gcash + cash with change",
        "total": "67.17",
        "payments": [
            {"method_kind": "EWALLET", "amount": "50.00"},
            {"method_kind": "CASH", "amount": "17.17", "tendered": "20.00"},
        ],
    },
    {
        "name": "underpaid is an error",
        "total": "67.17",
        "payments": [{"method_kind": "CARD", "amount": "60.00"}],
        "error": True,
    },
    {
        "name": "card cannot be over-tendered",
        "total": "10.00",
        "payments": [{"method_kind": "CARD", "amount": "10.00", "tendered": "20.00"}],
        "error": True,
    },
]


def _discount(raw: dict[str, str] | None) -> Discount | None:
    return Discount(DiscountKind(raw["kind"]), Decimal(raw["value"])) if raw else None


def _line(raw: dict[str, Any]) -> LineInput:
    return LineInput(
        quantity=Decimal(raw["quantity"]),
        unit_price=Decimal(raw["unit_price"]),
        tax_rate=Decimal(raw["tax_rate"]),
        tax_kind=raw.get("tax_kind", "VATABLE"),
        discount=_discount(raw.get("discount")),
        statutory=raw.get("statutory", False),
    )


def build() -> dict[str, Any]:
    cases = []
    for case in CASES:
        result = calculate_sale(
            [_line(line) for line in case["lines"]],
            prices_include_tax=case["prices_include_tax"],
            order_discount=_discount(case.get("order_discount")),
        )
        cases.append(
            {
                **case,
                "expected": {
                    "lines": [{k: str(v) for k, v in vars_(r).items()} for r in result.lines],
                    "totals": {k: str(v) for k, v in vars_(result.totals).items()},
                },
            }
        )
    payments = []
    for case in PAYMENT_CASES:
        entry = dict(case)
        if not case.get("error"):
            summary = settle_payments(
                Decimal(case["total"]),
                [
                    PaymentInput(
                        p["method_kind"],
                        Decimal(p["amount"]),
                        Decimal(p["tendered"]) if "tendered" in p else None,
                    )
                    for p in case["payments"]
                ],
            )
            entry["expected"] = {
                "paid_total": str(summary.paid_total),
                "change_total": str(summary.change_total),
            }
        payments.append(entry)
    return {
        "description": "Generated by backend/scripts/gen_sale_vectors.py. Do not edit by hand.",
        "rounding": "HALF_UP to 2 decimals at each step",
        "sales": cases,
        "payments": payments,
    }


def vars_(obj: object) -> dict[str, Decimal]:
    return {name: getattr(obj, name) for name in obj.__slots__}  # type: ignore[attr-defined]


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(build(), indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}")
