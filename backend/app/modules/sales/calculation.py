"""Sale arithmetic: discounts, allocation, tax, totals.

This is a *contract* shared with the POS (`frontend/lib/money/sale-calculation.ts`). Both sides
run `shared/test-vectors/sale_calculation.json`. Change the algorithm only together with the
vectors and the TypeScript implementation. See docs/ARCHITECTURE.md §5.

All amounts are rounded HALF_UP to 2 decimals at each named step.

Senior citizen / PWD lines (`statutory=True`) follow `_statutory_line` instead: VAT exemption +
20% discount, no other line or order discounts, VAT-exempt. Invariant for every line:
    total = gross - line_discount - order_discount_share - vat_exemption - statutory_discount
            (+ tax_amount when prices exclude tax)
"""

from collections.abc import Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from enum import StrEnum

CENT = Decimal("0.01")
ZERO = Decimal("0.00")
HUNDRED = Decimal(100)


def money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


class DiscountKind(StrEnum):
    PERCENT = "PERCENT"
    AMOUNT = "AMOUNT"


class CalculationError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class Discount:
    kind: DiscountKind
    value: Decimal

    def amount_of(self, base: Decimal) -> Decimal:
        if self.value < 0:
            raise CalculationError("Discount cannot be negative")
        if self.kind == DiscountKind.PERCENT:
            if self.value > HUNDRED:
                raise CalculationError("Percent discount cannot exceed 100")
            return money(base * self.value / HUNDRED)
        amount = money(self.value)
        if amount > base:
            raise CalculationError("Discount exceeds the amount it applies to")
        return amount


@dataclass(frozen=True, slots=True)
class LineInput:
    quantity: Decimal
    unit_price: Decimal
    tax_rate: Decimal  # percent, e.g. 12
    tax_kind: str = "VATABLE"  # VATABLE | EXEMPT | ZERO_RATED
    discount: Discount | None = None
    # Senior citizen / PWD statutory discount applies to this line (RA 9994 / RA 10754).
    statutory: bool = False


@dataclass(frozen=True, slots=True)
class LineResult:
    gross: Decimal
    line_discount: Decimal
    order_discount_share: Decimal
    net: Decimal
    tax_amount: Decimal
    total: Decimal
    vat_exemption: Decimal = ZERO
    statutory_discount: Decimal = ZERO


@dataclass(frozen=True, slots=True)
class SaleTotals:
    gross_total: Decimal
    line_discount_total: Decimal
    order_discount_total: Decimal
    discount_total: Decimal
    tax_total: Decimal
    total: Decimal
    # Receipt tax breakdown (amounts net of VAT for vatable sales).
    vatable_sales: Decimal
    vat_amount: Decimal
    exempt_sales: Decimal
    zero_rated_sales: Decimal
    # Senior citizen / PWD: VAT removed and the statutory discount given.
    vat_exemption_total: Decimal = ZERO
    statutory_discount_total: Decimal = ZERO


STATUTORY_RATE = Decimal(20)  # percent, RA 9994 (senior citizens) and RA 10754 (PWD)


@dataclass(frozen=True, slots=True)
class SaleCalculation:
    lines: list[LineResult]
    totals: SaleTotals


def allocate(amount: Decimal, bases: Sequence[Decimal]) -> list[Decimal]:
    """Split `amount` across lines proportionally to `bases`; shares sum exactly to `amount`.

    Each share is rounded; the rounding remainder goes to the line with the largest base
    (first one on ties).
    """
    total_base = sum(bases, ZERO)
    if amount == 0 or total_base == 0:
        return [ZERO for _ in bases]
    shares = [money(amount * base / total_base) for base in bases]
    remainder = amount - sum(shares, ZERO)
    if remainder:
        largest = max(range(len(bases)), key=lambda i: (bases[i], -i))
        shares[largest] += remainder
    return shares


def calculate_sale(
    lines: Sequence[LineInput],
    *,
    prices_include_tax: bool,
    order_discount: Discount | None = None,
) -> SaleCalculation:
    if not lines:
        raise CalculationError("A sale needs at least one line")

    gross: list[Decimal] = []
    line_discounts: list[Decimal] = []
    for line in lines:
        if line.quantity <= 0:
            raise CalculationError("Quantity must be positive")
        if line.unit_price < 0:
            raise CalculationError("Price cannot be negative")
        g = money(line.unit_price * line.quantity)
        gross.append(g)
        # Statutory lines take no other discount (the law forbids double discounts).
        has_discount = line.discount is not None and not line.statutory
        line_discounts.append(
            line.discount.amount_of(g) if has_discount and line.discount else ZERO
        )

    # Statutory lines are also excluded from the order discount (base 0 → share 0).
    after_line = [
        ZERO if line.statutory else g - d
        for line, g, d in zip(lines, gross, line_discounts, strict=True)
    ]
    base_total = sum(after_line, ZERO)
    order_discount_total = order_discount.amount_of(base_total) if order_discount else ZERO
    shares = allocate(order_discount_total, after_line)

    results: list[LineResult] = []
    vatable = vat = exempt = zero_rated = ZERO
    vat_exemption_total = statutory_total = ZERO
    for line, g, d, share in zip(lines, gross, line_discounts, shares, strict=True):
        if line.statutory:
            result = _statutory_line(line, g, prices_include_tax=prices_include_tax)
            results.append(result)
            exempt += result.total
            vat_exemption_total += result.vat_exemption
            statutory_total += result.statutory_discount
            continue
        net = g - d - share
        if prices_include_tax:
            tax = money(net * line.tax_rate / (HUNDRED + line.tax_rate))
            total = net
        else:
            tax = money(net * line.tax_rate / HUNDRED)
            total = net + tax
        results.append(LineResult(g, d, share, net, tax, total))
        if line.tax_kind == "EXEMPT":
            exempt += total - tax
        elif line.tax_kind == "ZERO_RATED":
            zero_rated += total - tax
        else:
            vatable += total - tax
            vat += tax

    line_discount_total = sum(line_discounts, ZERO)
    tax_total = sum((r.tax_amount for r in results), ZERO)
    return SaleCalculation(
        lines=results,
        totals=SaleTotals(
            gross_total=sum(gross, ZERO),
            line_discount_total=line_discount_total,
            order_discount_total=order_discount_total,
            discount_total=line_discount_total + order_discount_total + statutory_total,
            tax_total=tax_total,
            total=sum((r.total for r in results), ZERO),
            vatable_sales=vatable,
            vat_amount=vat,
            exempt_sales=exempt,
            zero_rated_sales=zero_rated,
            vat_exemption_total=vat_exemption_total,
            statutory_discount_total=statutory_total,
        ),
    )


def _statutory_line(line: LineInput, gross: Decimal, *, prices_include_tax: bool) -> LineResult:
    """Senior citizen / PWD line: remove VAT, then 20% off the VAT-exclusive price.

    base          = gross / (1 + rate)   (VAT-inclusive VATable prices; otherwise gross)
    vat_exemption = gross - base
    discount      = round(base x 20%)
    total         = base - discount      (VAT-exempt: tax 0)
    """
    if line.tax_kind == "VATABLE" and line.tax_rate > 0 and prices_include_tax:
        base = money(gross * HUNDRED / (HUNDRED + line.tax_rate))
    else:
        base = gross  # exclusive prices: VAT is simply not added
    vat_exemption = gross - base
    discount = money(base * STATUTORY_RATE / HUNDRED)
    net = base - discount
    return LineResult(
        gross=gross,
        line_discount=ZERO,
        order_discount_share=ZERO,
        net=net,
        tax_amount=ZERO,
        total=net,
        vat_exemption=vat_exemption,
        statutory_discount=discount,
    )


@dataclass(frozen=True, slots=True)
class PaymentInput:
    method_kind: str  # CASH | EWALLET | CARD | BANK | OTHER
    amount: Decimal  # applied to the sale
    tendered: Decimal | None = None  # cash handed over (>= amount)


@dataclass(frozen=True, slots=True)
class PaymentSummary:
    paid_total: Decimal
    change_total: Decimal


def settle_payments(total: Decimal, payments: Sequence[PaymentInput]) -> PaymentSummary:
    """Validate split payments. Applied amounts must equal the total; only cash gives change."""
    if not payments:
        raise CalculationError("At least one payment is required")
    paid = ZERO
    change = ZERO
    for p in payments:
        if p.amount <= 0:
            raise CalculationError("Payment amounts must be positive")
        paid += money(p.amount)
        if p.tendered is not None:
            if p.method_kind != "CASH" and p.tendered != p.amount:
                raise CalculationError("Only cash can be over-tendered")
            if p.tendered < p.amount:
                raise CalculationError("Tendered amount is less than the applied amount")
            change += money(p.tendered) - money(p.amount)
    if paid != total:
        raise CalculationError(f"Payments ({paid}) do not equal the sale total ({total})")
    return PaymentSummary(paid_total=paid, change_total=change)
