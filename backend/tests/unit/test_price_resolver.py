import uuid
from decimal import Decimal

from app.modules.pricing.resolver import PriceCandidate, resolve_price

PC, BOX = uuid.uuid4(), uuid.uuid4()
RETAIL, WHOLESALE = uuid.uuid4(), uuid.uuid4()
BRANCH_A, BRANCH_B = uuid.uuid4(), uuid.uuid4()


def c(
    unit: uuid.UUID,
    level: uuid.UUID,
    price: str,
    min_qty: str = "1",
    branch: uuid.UUID | None = None,
) -> PriceCandidate:
    return PriceCandidate(unit, level, branch, Decimal(min_qty), Decimal(price))


CANDIDATES = [
    c(PC, RETAIL, "25.00"),
    c(PC, RETAIL, "23.50", min_qty="12"),
    c(PC, RETAIL, "24.00", branch=BRANCH_A),
    c(BOX, RETAIL, "270.00"),
    c(PC, WHOLESALE, "22.00"),
]


def resolve(
    unit: uuid.UUID = PC,
    level: uuid.UUID = RETAIL,
    branch: uuid.UUID | None = BRANCH_B,
    qty: str = "1",
) -> Decimal | None:
    found = resolve_price(
        CANDIDATES,
        product_unit_id=unit,
        price_level_id=level,
        default_price_level_id=RETAIL,
        branch_id=branch,
        quantity=Decimal(qty),
    )
    return found.price if found else None


def test_base_price() -> None:
    assert resolve() == Decimal("25.00")


def test_quantity_break() -> None:
    assert resolve(qty="11") == Decimal("25.00")
    assert resolve(qty="12") == Decimal("23.50")


def test_branch_override_beats_company_price_and_breaks() -> None:
    assert resolve(branch=BRANCH_A) == Decimal("24.00")
    assert resolve(branch=BRANCH_A, qty="20") == Decimal("24.00")


def test_unit_specific_price() -> None:
    assert resolve(unit=BOX) == Decimal("270.00")


def test_level_falls_back_to_default() -> None:
    assert resolve(level=WHOLESALE) == Decimal("22.00")
    assert resolve(level=WHOLESALE, unit=BOX) == Decimal("270.00")  # no wholesale BOX price


def test_no_price_for_unit() -> None:
    assert resolve(unit=uuid.uuid4()) is None
