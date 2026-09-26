"""Voids and returns (Phase 7).

Both are reachable two ways — online (admin/POS API) and offline (sync operations `sale.void`,
`return.create`) — and both go through the functions here, so the rules are identical.

- **Void**: cancels a whole sale, typically moments after it was rung up. Allowed only while the
  sale's cash session is open (compared by time: a void that happened before the shift was
  closed is accepted even if it syncs after the close). Reverses stock with SALE_VOID.
- **Return**: gives back some or all items of a completed sale, any time later. Refunds are
  the pro-rata share of what was actually paid per line, never more than the line total.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.branches.models import StockLocation
from app.modules.cash_management.models import CashSession
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import MovementSpec, post_movements, quantize_qty
from app.modules.payments.models import PaymentMethod, PaymentStatus
from app.modules.returns.models import Refund, ReturnItem, SaleReturn
from app.modules.sales.models import Sale, SaleStatus
from app.shared.exceptions import BusinessRuleError, NotFoundError
from app.shared.ids import derived_id

CENT = Decimal("0.01")


async def _locked_sale(db: AsyncSession, company_id: uuid.UUID, sale_id: uuid.UUID) -> Sale:
    # Lock the sale row: concurrent voids/returns of the same sale are serialized.
    sale = await db.scalar(
        select(Sale)
        .where(Sale.company_id == company_id, Sale.id == sale_id)
        .options(selectinload(Sale.items), selectinload(Sale.payments))
        .with_for_update(of=Sale)
        .execution_options(populate_existing=True)
    )
    if sale is None:
        raise NotFoundError("Sale not found", code="sale.not_found")
    return sale


# --- voids ---------------------------------------------------------------------------------


async def void_sale(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    sale_id: uuid.UUID,
    voided_by_id: uuid.UUID,
    authorized_by_id: uuid.UUID | None,
    reason: str,
    occurred_at: datetime,
    device_id: uuid.UUID | None,
) -> Sale:
    sale = await _locked_sale(db, company_id, sale_id)
    if sale.status == SaleStatus.VOIDED:
        raise BusinessRuleError("Sale is already voided", code="sale.already_voided")
    if await db.scalar(
        select(SaleReturn.id).where(SaleReturn.original_sale_id == sale.id).limit(1)
    ):
        raise BusinessRuleError(
            "Items of this sale were returned; return the remaining items instead",
            code="sale.has_returns",
        )
    if sale.cash_session_id:
        session = await db.get(CashSession, sale.cash_session_id)
        if session and session.closed_at and occurred_at > session.closed_at:
            raise BusinessRuleError(
                "The shift of this sale is closed; process a return instead",
                code="sale.session_closed",
            )

    sale.status = SaleStatus.VOIDED
    sale.voided_at = occurred_at
    sale.voided_by_id = voided_by_id
    sale.void_authorized_by_id = authorized_by_id
    sale.void_reason = reason
    for payment in sale.payments:
        payment.status = PaymentStatus.VOIDED
    await post_movements(
        db,
        company_id,
        [
            MovementSpec(
                id=derived_id(item.id, "SALE_VOID"),
                variant_id=item.variant_id,
                stock_location_id=sale.stock_location_id,
                quantity=item.base_quantity,
                movement_type=MovementType.SALE_VOID,
                reference_type="sale",
                reference_id=sale.id,
                unit_cost=item.unit_cost,
                occurred_at=occurred_at,
                note=reason,
            )
            for item in sale.items
        ],
        user_id=voided_by_id,
        device_id=device_id,
    )
    return sale


# --- returns -------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ReturnItemInput:
    id: uuid.UUID
    sale_item_id: uuid.UUID
    quantity: Decimal
    restock: bool = True


@dataclass(frozen=True, slots=True)
class RefundInput:
    id: uuid.UUID
    payment_method_id: uuid.UUID
    amount: Decimal
    reference_no: str | None = None


@dataclass(frozen=True, slots=True)
class ReturnInput:
    id: uuid.UUID
    sale_id: uuid.UUID
    return_number: str
    cashier_id: uuid.UUID
    authorized_by_id: uuid.UUID | None
    reason: str
    occurred_at: datetime
    items: list[ReturnItemInput]
    refunds: list[RefundInput]
    branch_id: uuid.UUID | None = None  # where the goods come back; default: the sale's branch
    device_id: uuid.UUID | None = None
    cash_session_id: uuid.UUID | None = None


def _money(value: Decimal) -> Decimal:
    return value.quantize(CENT, rounding=ROUND_HALF_UP)


async def create_return(db: AsyncSession, company_id: uuid.UUID, data: ReturnInput) -> SaleReturn:
    sale = await _locked_sale(db, company_id, data.sale_id)
    if sale.status != SaleStatus.COMPLETED:
        raise BusinessRuleError(
            "Only completed sales can be returned", code="return.sale_not_completed"
        )
    if not data.items:
        raise BusinessRuleError("Nothing to return", code="return.empty")
    items_by_id = {item.id: item for item in sale.items}

    previous = {
        sale_item_id: (qty, refunded)
        for sale_item_id, qty, refunded in (
            await db.execute(
                select(
                    ReturnItem.sale_item_id,
                    func.sum(ReturnItem.quantity),
                    func.sum(ReturnItem.refund_amount),
                )
                .where(ReturnItem.sale_item_id.in_(items_by_id))
                .group_by(ReturnItem.sale_item_id)
            )
        ).all()
    }

    branch_id = data.branch_id or sale.branch_id
    location = await db.scalar(
        select(StockLocation).where(
            StockLocation.company_id == company_id,
            StockLocation.branch_id == branch_id,
            StockLocation.is_default.is_(True),
        )
    )
    if location is None:
        raise BusinessRuleError(
            "Branch has no default stock location", code="branch.no_default_location"
        )

    lines: list[tuple[ReturnItemInput, Decimal, Decimal]] = []  # input, refund, base qty
    requested: dict[uuid.UUID, Decimal] = {}
    for item_in in data.items:
        sale_item = items_by_id.get(item_in.sale_item_id)
        if sale_item is None:
            raise NotFoundError("Item is not part of this sale", code="return.unknown_item")
        if item_in.quantity <= 0:
            raise BusinessRuleError(
                "Return quantity must be positive", code="return.invalid_quantity"
            )
        done_qty, done_refund = previous.get(sale_item.id, (Decimal(0), Decimal(0)))
        requested[sale_item.id] = requested.get(sale_item.id, Decimal(0)) + item_in.quantity
        remaining = sale_item.quantity - done_qty - (requested[sale_item.id] - item_in.quantity)
        if item_in.quantity > remaining:
            raise BusinessRuleError(
                "Returning more than was sold",
                code="return.over_return",
                details={"sale_item_id": str(sale_item.id), "remaining": str(remaining)},
            )
        if item_in.quantity == remaining:
            # Last units of the line: refund exactly what is left, so rounding never drifts.
            refund = (
                sale_item.total
                - done_refund
                - sum((r for i, r, _ in lines if i.sale_item_id == sale_item.id), Decimal(0))
            )
        else:
            refund = _money(sale_item.total * item_in.quantity / sale_item.quantity)
        lines.append((item_in, refund, quantize_qty(item_in.quantity * sale_item.unit_factor)))

    refund_total = sum((refund for _, refund, _ in lines), Decimal(0))
    paid_back = sum((r.amount for r in data.refunds), Decimal(0))
    if paid_back != refund_total:
        raise BusinessRuleError(
            f"Refund payments ({paid_back}) must equal the refund total ({refund_total})",
            code="return.refund_mismatch",
            details={"refund_total": str(refund_total)},
        )
    methods = {
        m.id: m
        for m in await db.scalars(
            select(PaymentMethod).where(
                PaymentMethod.company_id == company_id,
                PaymentMethod.id.in_({r.payment_method_id for r in data.refunds}),
            )
        )
    }
    if len(methods) != len({r.payment_method_id for r in data.refunds}):
        raise NotFoundError("Unknown payment method", code="payment_method.not_found")

    sale_return = SaleReturn(
        id=data.id,
        company_id=company_id,
        original_sale_id=sale.id,
        branch_id=branch_id,
        stock_location_id=location.id,
        device_id=data.device_id,
        cash_session_id=data.cash_session_id,
        return_number=data.return_number,
        cashier_id=data.cashier_id,
        authorized_by_id=data.authorized_by_id,
        reason=data.reason,
        refund_total=refund_total,
        occurred_at=data.occurred_at,
    )
    db.add(sale_return)
    await db.flush()
    specs: list[MovementSpec] = []
    for item_in, refund, base_qty in lines:
        sale_item = items_by_id[item_in.sale_item_id]
        db.add(
            ReturnItem(
                id=item_in.id,
                company_id=company_id,
                return_id=sale_return.id,
                sale_item_id=sale_item.id,
                variant_id=sale_item.variant_id,
                quantity=item_in.quantity,
                base_quantity=base_qty,
                refund_amount=refund,
                restock=item_in.restock,
            )
        )
        if item_in.restock:
            specs.append(
                MovementSpec(
                    id=derived_id(item_in.id, "SALE_RETURN"),
                    variant_id=sale_item.variant_id,
                    stock_location_id=location.id,
                    quantity=base_qty,
                    movement_type=MovementType.SALE_RETURN,
                    reference_type="return",
                    reference_id=sale_return.id,
                    unit_cost=sale_item.unit_cost,
                    occurred_at=data.occurred_at,
                    note=data.reason,
                )
            )
    for r in data.refunds:
        db.add(
            Refund(
                id=r.id,
                company_id=company_id,
                return_id=sale_return.id,
                payment_method_id=r.payment_method_id,
                method_kind=str(methods[r.payment_method_id].kind),
                amount=r.amount,
                reference_no=r.reference_no,
            )
        )
    await db.flush()
    await post_movements(db, company_id, specs, user_id=data.cashier_id, device_id=data.device_id)
    return sale_return


async def get_return(db: AsyncSession, company_id: uuid.UUID, return_id: uuid.UUID) -> SaleReturn:
    sale_return = await db.scalar(
        select(SaleReturn)
        .where(SaleReturn.company_id == company_id, SaleReturn.id == return_id)
        .options(selectinload(SaleReturn.items), selectinload(SaleReturn.refunds))
        .execution_options(populate_existing=True)
    )
    if sale_return is None:
        raise NotFoundError("Return not found", code="return.not_found")
    return sale_return


async def cash_refunds_in_session(db: AsyncSession, session_id: uuid.UUID) -> Decimal:
    value = await db.scalar(
        select(func.coalesce(func.sum(Refund.amount), 0))
        .join(SaleReturn, SaleReturn.id == Refund.return_id)
        .where(SaleReturn.cash_session_id == session_id, Refund.method_kind == "CASH")
    )
    return Decimal(value or 0)
