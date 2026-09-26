"""Handlers for pushed operations.

Each handler applies ONE operation inside the transaction opened by the sync service. Handlers
signal outcomes with exceptions:

- `Deferred`  — a dependency (e.g. the cash session) hasn't arrived yet; retry later.
- `Rejected`  — the payload can never be valid (tenant violation, unknown ids, bad schema).

Business anomalies (oversold stock, total mismatch, unauthorized cashier) are NOT rejections:
the fact is stored and a review flag is raised. See docs/SYNC_PROTOCOL.md §3 and §6.
"""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.branches.models import StockLocation
from app.modules.cash_management.models import (
    CASH_MOVEMENT_SIGN,
    CashMovement,
    CashSession,
    CashSessionStatus,
)
from app.modules.customers.models import Customer
from app.modules.customers.service import flag_duplicate_phone, normalize_phone
from app.modules.devices.models import Device
from app.modules.inventory.models import MovementType
from app.modules.inventory.service import MovementSpec, post_movements, quantize_qty
from app.modules.payments.models import Payment, PaymentKind, PaymentMethod
from app.modules.pricing.models import PriceLevel
from app.modules.products.models import ProductUnit, ProductVariant
from app.modules.promotions.models import Promotion
from app.modules.returns.service import (
    RefundInput,
    ReturnInput,
    ReturnItemInput,
    cash_refunds_in_session,
    create_return,
    void_sale,
)
from app.modules.review_flags.models import FlagType
from app.modules.review_flags.service import raise_flag
from app.modules.sales.calculation import (
    CalculationError,
    Discount,
    LineInput,
    PaymentInput,
    calculate_sale,
    settle_payments,
)
from app.modules.sales.models import Sale, SaleItem, SaleStatus
from app.modules.sync.schemas import (
    CashMovementPayload,
    CashSessionClosePayload,
    CashSessionOpenPayload,
    CustomerUpsertPayload,
    DiscountIn,
    ReturnCreatePayload,
    SaleCompletePayload,
    SaleVoidPayload,
)
from app.modules.users.models import User
from app.modules.users.permissions import P
from app.modules.users.repository import load_permission_scopes
from app.shared.exceptions import AppError
from app.shared.ids import derived_id


class Deferred(Exception):  # noqa: N818 - reads as an outcome, not an error
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class Rejected(Exception):  # noqa: N818
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details or {}


@dataclass(frozen=True, slots=True)
class OpContext:
    db: AsyncSession
    device: Device
    # Permission scopes per user, shared by all operations of one push request (a batch of
    # 100 sales by the same cashier would otherwise reload them 100 times).
    permissions: dict[uuid.UUID, tuple[frozenset[str], dict[uuid.UUID, frozenset[str]]]] = field(
        default_factory=dict
    )

    @property
    def company_id(self) -> uuid.UUID:
        return self.device.company_id

    @property
    def branch_id(self) -> uuid.UUID:
        return self.device.branch_id


Handler = Callable[[OpContext, dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass(frozen=True, slots=True)
class HandlerSpec:
    entity_type: str
    handler: Handler


def parse[M: BaseModel](model: type[M], payload: dict[str, Any]) -> M:
    try:
        return model.model_validate(payload)
    except ValidationError as exc:
        raise Rejected(
            "sync.invalid_payload",
            "Payload failed validation",
            {"errors": exc.errors(include_url=False, include_context=False)},
        ) from exc


# --- helpers -------------------------------------------------------------------------------


async def _company_users(ctx: OpContext, ids: set[uuid.UUID]) -> dict[uuid.UUID, User]:
    users = {
        u.id: u
        for u in await ctx.db.scalars(
            select(User).where(User.company_id == ctx.company_id, User.id.in_(ids))
        )
    }
    if missing := ids - users.keys():
        raise Rejected(
            "sync.unknown_user", "Unknown user", {"user_ids": sorted(str(u) for u in missing)}
        )
    return users


async def _check_authorized(
    ctx: OpContext,
    user: User,
    permission: P,
    *,
    entity_type: str,
    entity_id: uuid.UUID,
    role: str,
) -> None:
    """Offline logins are a convenience gate; the server re-validates on sync (SECURITY.md §4)."""
    if user.id not in ctx.permissions:
        ctx.permissions[user.id] = await load_permission_scopes(ctx.db, user.id)
    global_perms, branch_perms = ctx.permissions[user.id]
    allowed = permission in global_perms or permission in branch_perms.get(
        ctx.branch_id, frozenset()
    )
    if not user.is_active or not allowed:
        await raise_flag(
            ctx.db,
            company_id=ctx.company_id,
            flag_type=FlagType.USER_NOT_AUTHORIZED,
            entity_type=entity_type,
            entity_id=entity_id,
            branch_id=ctx.branch_id,
            details={
                "user_id": str(user.id),
                "username": user.username,
                "role_in_transaction": role,
                "permission": permission.value,
                "user_active": user.is_active,
            },
        )


async def _own_session(ctx: OpContext, session_id: uuid.UUID) -> CashSession:
    session = await ctx.db.get(CashSession, session_id, with_for_update=True)
    if session is None:
        raise Deferred("sync.cash_session_missing", "Cash session has not been synced yet")
    if session.device_id != ctx.device.id:
        raise Rejected("sync.foreign_cash_session", "Cash session belongs to another device")
    return session


# --- cash sessions -------------------------------------------------------------------------


async def open_cash_session(ctx: OpContext, payload: dict[str, Any]) -> dict[str, Any]:
    data = parse(CashSessionOpenPayload, payload)
    users = await _company_users(ctx, {data.opened_by_id})
    ctx.db.add(
        CashSession(
            id=data.id,
            company_id=ctx.company_id,
            branch_id=ctx.branch_id,
            device_id=ctx.device.id,
            opened_by_id=data.opened_by_id,
            opened_at=data.opened_at,
            opening_float=data.opening_float,
        )
    )
    await ctx.db.flush()
    await _check_authorized(
        ctx,
        users[data.opened_by_id],
        P.CASH_SESSION,
        entity_type="cash_session",
        entity_id=data.id,
        role="opened_by",
    )
    return {"cash_session_id": str(data.id)}


async def record_cash_movement(ctx: OpContext, payload: dict[str, Any]) -> dict[str, Any]:
    data = parse(CashMovementPayload, payload)
    await _own_session(ctx, data.cash_session_id)
    ids = {data.user_id} | ({data.authorized_by_id} if data.authorized_by_id else set())
    users = await _company_users(ctx, ids)
    ctx.db.add(
        CashMovement(
            id=data.id,
            company_id=ctx.company_id,
            cash_session_id=data.cash_session_id,
            movement_type=data.movement_type,
            amount=data.amount,
            reason=data.reason,
            user_id=data.user_id,
            authorized_by_id=data.authorized_by_id,
            occurred_at=data.occurred_at,
        )
    )
    await ctx.db.flush()
    approver = users[data.authorized_by_id] if data.authorized_by_id else users[data.user_id]
    await _check_authorized(
        ctx,
        approver,
        P.CASH_MANAGE,
        entity_type="cash_movement",
        entity_id=data.id,
        role="authorized_by" if data.authorized_by_id else "user",
    )
    return {"cash_movement_id": str(data.id)}


async def expected_cash(db: AsyncSession, session: CashSession) -> Decimal:
    """Opening float + cash taken for completed sales (net of change) +/- cash movements - cash
    refunds."""
    cash_sales = await db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0))
        .join(Sale, Sale.id == Payment.sale_id)
        .where(
            Sale.cash_session_id == session.id,
            Sale.status == SaleStatus.COMPLETED,
            Payment.method_kind == PaymentKind.CASH,
        )
    )
    movements = Decimal(0)
    for movement_type, amount in (
        await db.execute(
            select(CashMovement.movement_type, func.sum(CashMovement.amount))
            .where(CashMovement.cash_session_id == session.id)
            .group_by(CashMovement.movement_type)
        )
    ).all():
        movements += CASH_MOVEMENT_SIGN[movement_type] * amount
    refunds = await cash_refunds_in_session(db, session.id)
    return session.opening_float + Decimal(cash_sales or 0) + movements - refunds


async def close_cash_session(ctx: OpContext, payload: dict[str, Any]) -> dict[str, Any]:
    data = parse(CashSessionClosePayload, payload)
    session = await _own_session(ctx, data.id)
    users = await _company_users(ctx, {data.closed_by_id})
    if session.status == CashSessionStatus.CLOSED:
        raise Rejected("sync.cash_session_closed", "Cash session is already closed")
    session.status = CashSessionStatus.CLOSED
    session.closed_by_id = data.closed_by_id
    session.closed_at = data.closed_at
    session.counted_cash = data.counted_cash
    session.expected_cash = data.expected_cash
    session.over_short = data.over_short
    session.closing_note = data.note
    session.server_expected_cash = await expected_cash(ctx.db, session)
    if session.server_expected_cash != data.expected_cash:
        await raise_flag(
            ctx.db,
            company_id=ctx.company_id,
            flag_type=FlagType.CASH_SESSION_MISMATCH,
            entity_type="cash_session",
            entity_id=session.id,
            branch_id=ctx.branch_id,
            details={
                "terminal_expected": str(data.expected_cash),
                "server_expected": str(session.server_expected_cash),
            },
        )
    await _check_authorized(
        ctx,
        users[data.closed_by_id],
        P.CASH_SESSION,
        entity_type="cash_session",
        entity_id=session.id,
        role="closed_by",
    )
    return {"server_expected_cash": str(session.server_expected_cash)}


# --- sales ---------------------------------------------------------------------------------


def _discount(d: DiscountIn | None) -> Discount | None:
    return Discount(d.kind, d.value) if d else None


def _compare(label: str, client: Decimal, server: Decimal, diffs: list[dict[str, str]]) -> None:
    if client != server:
        diffs.append({"field": label, "terminal": str(client), "server": str(server)})


async def complete_sale(ctx: OpContext, payload: dict[str, Any]) -> dict[str, Any]:
    data = parse(SaleCompletePayload, payload)
    db = ctx.db

    # Where the goods left from.
    location_stmt = select(StockLocation).where(
        StockLocation.company_id == ctx.company_id, StockLocation.branch_id == ctx.branch_id
    )
    if data.stock_location_id:
        location_stmt = location_stmt.where(StockLocation.id == data.stock_location_id)
    else:
        location_stmt = location_stmt.where(StockLocation.is_default.is_(True))
    location = await db.scalar(location_stmt)
    if location is None:
        raise Rejected("sync.invalid_location", "Stock location is not in this device's branch")

    if data.cash_session_id:
        await _own_session(ctx, data.cash_session_id)

    if not await db.scalar(
        select(PriceLevel.id).where(
            PriceLevel.company_id == ctx.company_id, PriceLevel.id == data.price_level_id
        )
    ):
        raise Rejected("sync.unknown_price_level", "Unknown price level")
    if data.customer_id:
        customer = await db.get(Customer, data.customer_id)
        if customer is None:
            # Created offline on this terminal; its customer.upsert has not arrived yet.
            raise Deferred("sync.customer_missing", "Customer has not been synced yet")
        if customer.company_id != ctx.company_id:
            raise Rejected("sync.foreign_customer", "Customer belongs to another company")
    promotion_ids = {i.promotion_id for i in data.items if i.promotion_id}
    if promotion_ids:
        known = set(
            await db.scalars(
                select(Promotion.id).where(
                    Promotion.company_id == ctx.company_id, Promotion.id.in_(promotion_ids)
                )
            )
        )
        if promotion_ids - known:
            raise Rejected("sync.unknown_promotion", "Unknown promotion")

    # People involved: cashier + anyone who authorized a discount/override.
    authorizers: dict[uuid.UUID, P] = {}
    if data.order_discount and data.order_discount.authorized_by_id:
        authorizers[data.order_discount.authorized_by_id] = P.SALES_DISCOUNT_OVERRIDE
    for item in data.items:
        if item.discount and item.discount.authorized_by_id:
            authorizers[item.discount.authorized_by_id] = P.SALES_DISCOUNT_OVERRIDE
        if item.price_overridden_by_id:
            authorizers[item.price_overridden_by_id] = P.SALES_PRICE_OVERRIDE
    users = await _company_users(ctx, {data.cashier_id, *authorizers})

    # Catalog references must exist in this company.
    variant_ids = {i.variant_id for i in data.items}
    variants = {
        v.id: v
        for v in await db.scalars(
            select(ProductVariant).where(
                ProductVariant.company_id == ctx.company_id, ProductVariant.id.in_(variant_ids)
            )
        )
    }
    if missing := variant_ids - variants.keys():
        raise Rejected(
            "sync.unknown_variant", "Unknown product", {"variant_ids": sorted(map(str, missing))}
        )
    units = {
        u.id: u
        for u in await db.scalars(
            select(ProductUnit).where(ProductUnit.id.in_({i.product_unit_id for i in data.items}))
        )
    }
    for item in data.items:
        unit = units.get(item.product_unit_id)
        if unit is None or unit.product_id != variants[item.variant_id].product_id:
            raise Rejected("sync.unknown_unit", "Unit does not belong to the product")
    methods = {
        m.id: m
        for m in await db.scalars(
            select(PaymentMethod).where(
                PaymentMethod.company_id == ctx.company_id,
                PaymentMethod.id.in_({p.payment_method_id for p in data.payments}),
            )
        )
    }
    if len(methods) != len({p.payment_method_id for p in data.payments}):
        raise Rejected("sync.unknown_payment_method", "Unknown payment method")

    # Verify the terminal's arithmetic. Mismatches are flagged, never "corrected": the stored
    # totals are what the customer was charged.
    diffs: list[dict[str, str]] = []
    try:
        calc = calculate_sale(
            [
                LineInput(
                    i.quantity, i.unit_price, i.tax_rate, i.tax_kind.value, _discount(i.discount)
                )
                for i in data.items
            ],
            prices_include_tax=data.prices_include_tax,
            order_discount=_discount(data.order_discount),
        )
        for item, line in zip(data.items, calc.lines, strict=True):
            for name in (
                "gross",
                "line_discount",
                "order_discount_share",
                "net",
                "tax_amount",
                "total",
            ):
                _compare(
                    f"line {item.line_no} {name}", getattr(item, name), getattr(line, name), diffs
                )
        for name in (
            "gross_total",
            "line_discount_total",
            "order_discount_total",
            "discount_total",
            "tax_total",
            "total",
            "vatable_sales",
            "vat_amount",
            "exempt_sales",
            "zero_rated_sales",
        ):
            _compare(name, getattr(data.totals, name), getattr(calc.totals, name), diffs)
    except CalculationError as exc:
        diffs.append({"field": "calculation", "terminal": "n/a", "server": str(exc)})
    try:
        settlement = settle_payments(
            data.totals.total,
            [
                PaymentInput(str(methods[p.payment_method_id].kind), p.amount, p.tendered)
                for p in data.payments
            ],
        )
        _compare("paid_total", data.totals.paid_total, settlement.paid_total, diffs)
        _compare("change_total", data.totals.change_total, settlement.change_total, diffs)
    except CalculationError as exc:
        diffs.append(
            {"field": "payments", "terminal": str(data.totals.paid_total), "server": str(exc)}
        )

    t = data.totals
    od = data.order_discount
    sale = Sale(
        id=data.id,
        company_id=ctx.company_id,
        branch_id=ctx.branch_id,
        stock_location_id=location.id,
        device_id=ctx.device.id,
        cash_session_id=data.cash_session_id,
        receipt_number=data.receipt_number,
        cashier_id=data.cashier_id,
        customer_id=data.customer_id,
        price_level_id=data.price_level_id,
        prices_include_tax=data.prices_include_tax,
        gross_total=t.gross_total,
        line_discount_total=t.line_discount_total,
        order_discount_total=t.order_discount_total,
        discount_total=t.discount_total,
        tax_total=t.tax_total,
        total=t.total,
        paid_total=t.paid_total,
        change_total=t.change_total,
        vatable_sales=t.vatable_sales,
        vat_amount=t.vat_amount,
        exempt_sales=t.exempt_sales,
        zero_rated_sales=t.zero_rated_sales,
        order_discount_kind=od.kind.value if od else None,
        order_discount_value=od.value if od else None,
        order_discount_reason=od.reason if od else None,
        order_discount_authorized_by_id=od.authorized_by_id if od else None,
        notes=data.notes,
        occurred_at=data.occurred_at,
        totals_mismatch=bool(diffs),
    )
    db.add(sale)
    await db.flush()

    specs: list[MovementSpec] = []
    for item in data.items:
        variant = variants[item.variant_id]
        base_quantity = quantize_qty(item.quantity * item.unit_factor)
        db.add(
            SaleItem(
                id=item.id,
                company_id=ctx.company_id,
                sale_id=sale.id,
                line_no=item.line_no,
                product_id=variant.product_id,
                variant_id=variant.id,
                product_unit_id=item.product_unit_id,
                unit_factor=item.unit_factor,
                unit_code=item.unit_code,
                product_name=item.product_name,
                variant_name=item.variant_name,
                sku=item.sku,
                barcode=item.barcode,
                quantity=item.quantity,
                base_quantity=base_quantity,
                unit_price=item.unit_price,
                original_unit_price=item.original_unit_price,
                price_overridden_by_id=item.price_overridden_by_id,
                discount_kind=item.discount.kind.value if item.discount else None,
                discount_value=item.discount.value if item.discount else None,
                discount_reason=item.discount.reason if item.discount else None,
                discount_authorized_by_id=item.discount.authorized_by_id if item.discount else None,
                promotion_id=item.promotion_id,
                gross=item.gross,
                line_discount=item.line_discount,
                order_discount_share=item.order_discount_share,
                net=item.net,
                tax_rate_id=item.tax_rate_id,
                tax_rate=item.tax_rate,
                tax_kind=item.tax_kind.value,
                tax_amount=item.tax_amount,
                total=item.total,
                unit_cost=variant.average_cost,
            )
        )
        if units[item.product_unit_id].factor != item.unit_factor:
            diffs.append(
                {
                    "field": f"line {item.line_no} unit_factor",
                    "terminal": str(item.unit_factor),
                    "server": str(units[item.product_unit_id].factor),
                }
            )
        specs.append(
            MovementSpec(
                id=derived_id(item.id, "SALE"),
                variant_id=variant.id,
                stock_location_id=location.id,
                quantity=base_quantity,
                movement_type=MovementType.SALE,
                reference_type="sale",
                reference_id=sale.id,
                unit_cost=variant.average_cost,
                occurred_at=data.occurred_at,
            )
        )
    for p in data.payments:
        method = methods[p.payment_method_id]
        change = (
            (p.tendered - p.amount)
            if p.tendered is not None and p.tendered > p.amount
            else Decimal(0)
        )
        db.add(
            Payment(
                id=p.id,
                company_id=ctx.company_id,
                sale_id=sale.id,
                payment_method_id=method.id,
                method_kind=method.kind,
                amount=p.amount,
                tendered=p.tendered,
                change_amount=change,
                reference_no=p.reference_no,
                occurred_at=data.occurred_at,
            )
        )
    await db.flush()

    posting = await post_movements(
        db, ctx.company_id, specs, user_id=data.cashier_id, device_id=ctx.device.id
    )

    if diffs:
        sale.totals_mismatch = True
        await raise_flag(
            db,
            company_id=ctx.company_id,
            flag_type=FlagType.TOTAL_MISMATCH,
            entity_type="sale",
            entity_id=sale.id,
            branch_id=ctx.branch_id,
            details={"receipt_number": data.receipt_number, "differences": diffs},
        )
    await _check_authorized(
        ctx,
        users[data.cashier_id],
        P.POS_ACCESS,
        entity_type="sale",
        entity_id=sale.id,
        role="cashier",
    )
    for user_id, permission in authorizers.items():
        await _check_authorized(
            ctx,
            users[user_id],
            permission,
            entity_type="sale",
            entity_id=sale.id,
            role="authorized_by",
        )
    return {
        "sale_id": str(sale.id),
        "movements": len(posting.movements),
        "negative_stock_items": len(posting.negative),
        "totals_mismatch": bool(diffs),
    }


# --- customers, voids, returns (Phase 7) ----------------------------------------------------


async def upsert_customer(ctx: OpContext, payload: dict[str, Any]) -> dict[str, Any]:
    data = parse(CustomerUpsertPayload, payload)
    users = await _company_users(ctx, {data.user_id})
    if data.price_level_id and not await ctx.db.scalar(
        select(PriceLevel.id).where(
            PriceLevel.company_id == ctx.company_id, PriceLevel.id == data.price_level_id
        )
    ):
        raise Rejected("sync.unknown_price_level", "Unknown price level")
    customer = await ctx.db.get(Customer, data.id)
    if customer is not None and customer.company_id != ctx.company_id:
        raise Rejected("sync.foreign_customer", "Customer belongs to another company")
    fields = {
        "name": data.name,
        "code": data.code,
        "phone": normalize_phone(data.phone),
        "email": data.email,
        "price_level_id": data.price_level_id,
        "notes": data.notes,
    }
    if customer is None:
        customer = Customer(
            id=data.id, company_id=ctx.company_id, created_on_device_id=ctx.device.id, **fields
        )
        ctx.db.add(customer)
    else:
        for key, value in fields.items():
            setattr(customer, key, value)
    await ctx.db.flush()
    await flag_duplicate_phone(ctx.db, customer)
    await _check_authorized(
        ctx,
        users[data.user_id],
        P.CUSTOMERS_WRITE,
        entity_type="customer",
        entity_id=customer.id,
        role="created_by",
    )
    return {"customer_id": str(customer.id)}


async def _own_sale(ctx: OpContext, sale_id: uuid.UUID) -> Sale:
    sale = await ctx.db.get(Sale, sale_id)
    if sale is None:
        raise Deferred("sync.sale_missing", "The sale has not been synced yet")
    if sale.company_id != ctx.company_id:
        raise Rejected("sync.foreign_sale", "Sale belongs to another company")
    return sale


async def void_sale_op(ctx: OpContext, payload: dict[str, Any]) -> dict[str, Any]:
    data = parse(SaleVoidPayload, payload)
    sale = await _own_sale(ctx, data.id)
    if sale.device_id != ctx.device.id:
        raise Rejected(
            "sync.foreign_sale", "Offline voids are only possible on the selling terminal"
        )
    ids = {data.voided_by_id} | ({data.authorized_by_id} if data.authorized_by_id else set())
    users = await _company_users(ctx, ids)
    try:
        await void_sale(
            ctx.db,
            company_id=ctx.company_id,
            sale_id=sale.id,
            voided_by_id=data.voided_by_id,
            authorized_by_id=data.authorized_by_id,
            reason=data.reason,
            occurred_at=data.occurred_at,
            device_id=ctx.device.id,
        )
    except AppError as exc:
        raise Rejected(exc.code, exc.message, exc.details) from exc
    approver = users[data.authorized_by_id or data.voided_by_id]
    await _check_authorized(
        ctx, approver, P.SALES_VOID, entity_type="sale", entity_id=sale.id, role="authorized_by"
    )
    audit.record(
        ctx.db,
        AuditActor(company_id=ctx.company_id, user_id=data.voided_by_id, device_id=ctx.device.id),
        "sale.voided",
        entity_type="sale",
        entity_id=sale.id,
        branch_id=ctx.branch_id,
        occurred_at=data.occurred_at,
        metadata={
            "reason": data.reason,
            "receipt_number": sale.receipt_number,
            "authorized_by_id": str(data.authorized_by_id) if data.authorized_by_id else None,
            "via": "sync",
        },
    )
    return {"sale_id": str(sale.id), "status": "VOIDED"}


async def create_return_op(ctx: OpContext, payload: dict[str, Any]) -> dict[str, Any]:
    data = parse(ReturnCreatePayload, payload)
    await _own_sale(ctx, data.sale_id)
    if data.cash_session_id:
        await _own_session(ctx, data.cash_session_id)
    ids = {data.cashier_id} | ({data.authorized_by_id} if data.authorized_by_id else set())
    users = await _company_users(ctx, ids)
    try:
        sale_return = await create_return(
            ctx.db,
            ctx.company_id,
            ReturnInput(
                id=data.id,
                sale_id=data.sale_id,
                return_number=data.return_number,
                cashier_id=data.cashier_id,
                authorized_by_id=data.authorized_by_id,
                reason=data.reason,
                occurred_at=data.occurred_at,
                items=[
                    ReturnItemInput(i.id, i.sale_item_id, i.quantity, i.restock) for i in data.items
                ],
                refunds=[
                    RefundInput(r.id, r.payment_method_id, r.amount, r.reference_no)
                    for r in data.refunds
                ],
                branch_id=ctx.branch_id,
                device_id=ctx.device.id,
                cash_session_id=data.cash_session_id,
            ),
        )
    except AppError as exc:
        raise Rejected(exc.code, exc.message, exc.details) from exc
    approver = users[data.authorized_by_id or data.cashier_id]
    await _check_authorized(
        ctx,
        approver,
        P.RETURNS_CREATE,
        entity_type="return",
        entity_id=sale_return.id,
        role="authorized_by",
    )
    audit.record(
        ctx.db,
        AuditActor(company_id=ctx.company_id, user_id=data.cashier_id, device_id=ctx.device.id),
        "sale.returned",
        entity_type="return",
        entity_id=sale_return.id,
        branch_id=ctx.branch_id,
        occurred_at=data.occurred_at,
        metadata={
            "sale_id": str(data.sale_id),
            "refund_total": str(sale_return.refund_total),
            "authorized_by_id": str(data.authorized_by_id) if data.authorized_by_id else None,
            "via": "sync",
        },
    )
    return {"return_id": str(sale_return.id), "refund_total": str(sale_return.refund_total)}


# Priorities are assigned by the terminal (docs/SYNC_PROTOCOL.md §2); listed here for reference:
# customer.upsert 8, cash_session.open 5, sale.complete 10, sale.void 15,
# cash_movement.record / cash_session.close 40, return.create 50.
HANDLERS: dict[str, HandlerSpec] = {
    "cash_session.open": HandlerSpec("cash_session", open_cash_session),
    "cash_session.close": HandlerSpec("cash_session", close_cash_session),
    "cash_movement.record": HandlerSpec("cash_movement", record_cash_movement),
    "sale.complete": HandlerSpec("sale", complete_sale),
    "sale.void": HandlerSpec("sale", void_sale_op),
    "return.create": HandlerSpec("return", create_return_op),
    "customer.upsert": HandlerSpec("customer", upsert_customer),
}
