"""Report queries. All aggregation happens in PostgreSQL; Python only shapes the result.

Definitions (used consistently by every report):
- sales            = sum sale.total of COMPLETED sales (what customers were charged, incl. VAT
                     when prices include tax)
- gross_sales      = sum sale.gross_total (before discounts)
- discounts        = sum sale.discount_total
- returns          = sum return.refund_total (by return date)
- net_sales        = sales - returns
- revenue_ex_tax   = sum (item.total - item.tax_amount), minus the ex-tax share of refunds
- cogs             = sum item.base_quantity x item.unit_cost, minus the cost of restocked returns
- gross_profit     = revenue_ex_tax - cogs;  gross_margin = gross_profit / revenue_ex_tax
Voided sales are excluded everywhere except the voids report.
"""

import uuid
from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

from sqlalchemy import Select, and_, case, extract, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.branches.models import Branch, StockLocation
from app.modules.brands.models import Brand
from app.modules.cash_management.models import CashSession
from app.modules.categories.models import Category
from app.modules.expenses.models import Expense, ExpenseCategory
from app.modules.inventory.models import (
    InventoryBalance,
    InventoryMovement,
    StockCount,
    StockCountLine,
    StockCountStatus,
)
from app.modules.payments.models import Payment, PaymentMethod, PaymentStatus
from app.modules.products.models import Product, ProductVariant
from app.modules.purchasing.models import GoodsReceipt
from app.modules.reporting.period import Period
from app.modules.returns.models import ReturnItem, SaleReturn
from app.modules.sales.models import Sale, SaleItem, SaleStatus
from app.modules.suppliers.models import Supplier
from app.modules.users.models import User
from app.shared.exceptions import BusinessRuleError

ZERO = Decimal(0)
CENT = Decimal("0.01")
Row = dict[str, Any]


@dataclass(frozen=True, slots=True)
class Scope:
    company_id: uuid.UUID
    period: Period
    branch_ids: set[uuid.UUID] | None  # None = all branches the caller may see
    branch_id: uuid.UUID | None = None  # explicit filter


def _branch_filter(column: Any, scope: Scope) -> list[Any]:
    clauses = []
    if scope.branch_ids is not None:
        clauses.append(column.in_(scope.branch_ids))
    if scope.branch_id is not None:
        clauses.append(column == scope.branch_id)
    return clauses


def _completed_sales(scope: Scope) -> list[Any]:
    return [
        Sale.company_id == scope.company_id,
        Sale.status == SaleStatus.COMPLETED,
        Sale.occurred_at >= scope.period.start,
        Sale.occurred_at < scope.period.end,
        *_branch_filter(Sale.branch_id, scope),
    ]


def _returns_in_period(scope: Scope) -> list[Any]:
    return [
        SaleReturn.company_id == scope.company_id,
        SaleReturn.occurred_at >= scope.period.start,
        SaleReturn.occurred_at < scope.period.end,
        *_branch_filter(SaleReturn.branch_id, scope),
    ]


def _local(column: Any, scope: Scope) -> Any:
    return func.timezone(scope.period.timezone, column)


def _d(value: Any) -> Decimal:
    return Decimal(value or 0)


def _margin(profit: Decimal, revenue: Decimal) -> Decimal | None:
    return (profit / revenue * 100).quantize(CENT, rounding=ROUND_HALF_UP) if revenue else None


async def _rows(db: AsyncSession, stmt: Select[*tuple[Any, ...]]) -> list[Row]:
    return [dict(r._mapping) for r in (await db.execute(stmt)).all()]


# --- sales ---------------------------------------------------------------------------------


async def sales_summary(db: AsyncSession, scope: Scope) -> Row:
    sales = (
        await db.execute(
            select(
                func.count(Sale.id).label("transactions"),
                func.coalesce(func.sum(Sale.gross_total), 0).label("gross_sales"),
                func.coalesce(func.sum(Sale.discount_total), 0).label("discounts"),
                func.coalesce(func.sum(Sale.total), 0).label("sales"),
                func.coalesce(func.sum(Sale.tax_total), 0).label("tax"),
                func.coalesce(func.sum(Sale.statutory_discount_total), 0).label("statutory"),
                func.coalesce(func.sum(Sale.vat_exemption_total), 0).label("vat_exemption"),
            ).where(*_completed_sales(scope))
        )
    ).one()
    cogs = await db.scalar(
        select(func.coalesce(func.sum(SaleItem.base_quantity * SaleItem.unit_cost), 0))
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(*_completed_sales(scope))
    )
    returns = (
        await db.execute(
            select(
                func.count(func.distinct(SaleReturn.id)).label("returns_count"),
                func.coalesce(func.sum(ReturnItem.refund_amount), 0).label("refunds"),
                func.coalesce(
                    func.sum(
                        ReturnItem.refund_amount
                        * (SaleItem.total - SaleItem.tax_amount)
                        / func.nullif(SaleItem.total, 0)
                    ),
                    0,
                ).label("refunds_ex_tax"),
                func.coalesce(
                    func.sum(
                        case(
                            (ReturnItem.restock, ReturnItem.base_quantity * SaleItem.unit_cost),
                            else_=0,
                        )
                    ),
                    0,
                ).label("returned_cogs"),
            )
            .select_from(ReturnItem)
            .join(SaleReturn, SaleReturn.id == ReturnItem.return_id)
            .join(SaleItem, SaleItem.id == ReturnItem.sale_item_id)
            .where(*_returns_in_period(scope))
        )
    ).one()
    voids = (
        await db.execute(
            select(func.count(Sale.id), func.coalesce(func.sum(Sale.total), 0)).where(
                Sale.company_id == scope.company_id,
                Sale.status == SaleStatus.VOIDED,
                Sale.voided_at >= scope.period.start,
                Sale.voided_at < scope.period.end,
                *_branch_filter(Sale.branch_id, scope),
            )
        )
    ).one()

    revenue_ex_tax = _d(sales.sales) - _d(sales.tax) - _d(returns.refunds_ex_tax)
    cogs_net = _d(cogs) - _d(returns.returned_cogs)
    profit = revenue_ex_tax - cogs_net
    transactions = int(sales.transactions)
    return {
        "transactions": transactions,
        "gross_sales": _d(sales.gross_sales),
        "discounts": _d(sales.discounts),
        "sc_pwd_discounts": _d(sales.statutory),
        "vat_exemptions": _d(sales.vat_exemption),
        "sales": _d(sales.sales),
        "tax": _d(sales.tax),
        "returns_count": int(returns.returns_count),
        "returns": _d(returns.refunds),
        "net_sales": _d(sales.sales) - _d(returns.refunds),
        "average_ticket": (_d(sales.sales) / transactions).quantize(CENT, rounding=ROUND_HALF_UP)
        if transactions
        else ZERO,
        "voids_count": int(voids[0]),
        "voids_amount": _d(voids[1]),
        "revenue_ex_tax": revenue_ex_tax.quantize(CENT, rounding=ROUND_HALF_UP),
        "cogs": cogs_net.quantize(CENT, rounding=ROUND_HALF_UP),
        "gross_profit": profit.quantize(CENT, rounding=ROUND_HALF_UP),
        "gross_margin_pct": _margin(profit, revenue_ex_tax),
    }


async def sales_trend(
    db: AsyncSession, scope: Scope, granularity: Literal["day", "week", "month"] = "day"
) -> list[Row]:
    bucket = func.date_trunc(granularity, _local(Sale.occurred_at, scope)).label("period")
    return await _rows(
        db,
        select(
            bucket,
            func.count(Sale.id).label("transactions"),
            func.sum(Sale.total).label("sales"),
            func.sum(Sale.discount_total).label("discounts"),
        )
        .where(*_completed_sales(scope))
        .group_by(bucket)
        .order_by(bucket),
    )


async def sales_by_hour(db: AsyncSession, scope: Scope) -> list[Row]:
    hour = extract("hour", _local(Sale.occurred_at, scope)).label("hour")
    return await _rows(
        db,
        select(hour, func.count(Sale.id).label("transactions"), func.sum(Sale.total).label("sales"))
        .where(*_completed_sales(scope))
        .group_by(hour)
        .order_by(hour),
    )


def _item_metrics() -> list[Any]:
    return [
        func.sum(SaleItem.base_quantity).label("quantity"),
        func.sum(SaleItem.total).label("sales"),
        func.sum(SaleItem.total - SaleItem.tax_amount).label("revenue_ex_tax"),
        func.sum(SaleItem.base_quantity * SaleItem.unit_cost).label("cogs"),
        func.sum(
            SaleItem.total - SaleItem.tax_amount - SaleItem.base_quantity * SaleItem.unit_cost
        ).label("gross_profit"),
        func.count(func.distinct(SaleItem.sale_id)).label("transactions"),
    ]


async def sales_by_product(
    db: AsyncSession,
    scope: Scope,
    *,
    order: Literal["sales", "quantity"] = "sales",
    limit: int = 50,
) -> list[Row]:
    metrics = _item_metrics()
    order_col = metrics[1] if order == "sales" else metrics[0]
    return await _rows(
        db,
        select(
            SaleItem.variant_id,
            ProductVariant.sku,
            Product.name.label("product_name"),
            ProductVariant.name.label("variant_name"),
            *metrics,
        )
        .join(Sale, Sale.id == SaleItem.sale_id)
        .join(ProductVariant, ProductVariant.id == SaleItem.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(*_completed_sales(scope))
        .group_by(SaleItem.variant_id, ProductVariant.sku, Product.name, ProductVariant.name)
        .order_by(order_col.desc())
        .limit(limit),
    )


async def sales_by_category(db: AsyncSession, scope: Scope) -> list[Row]:
    return await _rows(
        db,
        select(
            Product.category_id,
            func.coalesce(Category.name, "Uncategorized").label("category"),
            *_item_metrics(),
        )
        .select_from(SaleItem)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .join(Product, Product.id == SaleItem.product_id)
        .outerjoin(Category, Category.id == Product.category_id)
        .where(*_completed_sales(scope))
        .group_by(Product.category_id, Category.name)
        .order_by(func.sum(SaleItem.total).desc()),
    )


async def sales_by_brand(db: AsyncSession, scope: Scope) -> list[Row]:
    return await _rows(
        db,
        select(
            Product.brand_id, func.coalesce(Brand.name, "No brand").label("brand"), *_item_metrics()
        )
        .select_from(SaleItem)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .join(Product, Product.id == SaleItem.product_id)
        .outerjoin(Brand, Brand.id == Product.brand_id)
        .where(*_completed_sales(scope))
        .group_by(Product.brand_id, Brand.name)
        .order_by(func.sum(SaleItem.total).desc()),
    )


async def sales_by_cashier(db: AsyncSession, scope: Scope) -> list[Row]:
    return await _rows(
        db,
        select(
            Sale.cashier_id,
            User.full_name.label("cashier"),
            func.count(Sale.id).label("transactions"),
            func.sum(Sale.total).label("sales"),
            func.sum(Sale.discount_total).label("discounts"),
        )
        .join(User, User.id == Sale.cashier_id)
        .where(*_completed_sales(scope))
        .group_by(Sale.cashier_id, User.full_name)
        .order_by(func.sum(Sale.total).desc()),
    )


async def sales_by_branch(db: AsyncSession, scope: Scope) -> list[Row]:
    return await _rows(
        db,
        select(
            Sale.branch_id,
            Branch.name.label("branch"),
            func.count(Sale.id).label("transactions"),
            func.sum(Sale.total).label("sales"),
        )
        .join(Branch, Branch.id == Sale.branch_id)
        .where(*_completed_sales(scope))
        .group_by(Sale.branch_id, Branch.name)
        .order_by(func.sum(Sale.total).desc()),
    )


async def sales_by_payment_method(db: AsyncSession, scope: Scope) -> list[Row]:
    return await _rows(
        db,
        select(
            Payment.payment_method_id,
            PaymentMethod.name.label("method"),
            Payment.method_kind,
            func.count(Payment.id).label("payments"),
            func.sum(Payment.amount).label("amount"),
        )
        .join(Sale, Sale.id == Payment.sale_id)
        .join(PaymentMethod, PaymentMethod.id == Payment.payment_method_id)
        .where(*_completed_sales(scope), Payment.status == PaymentStatus.CAPTURED)
        .group_by(Payment.payment_method_id, PaymentMethod.name, Payment.method_kind)
        .order_by(func.sum(Payment.amount).desc()),
    )


async def slow_movers(db: AsyncSession, scope: Scope, *, limit: int = 50) -> list[Row]:
    """Active items that have stock, ordered by quantity sold (least first, zero included)."""
    sold = (
        select(SaleItem.variant_id, func.sum(SaleItem.base_quantity).label("sold"))
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(*_completed_sales(scope))
        .group_by(SaleItem.variant_id)
        .subquery()
    )
    on_hand = (
        select(InventoryBalance.variant_id, func.sum(InventoryBalance.quantity).label("on_hand"))
        .where(
            InventoryBalance.company_id == scope.company_id,
            *_branch_filter(InventoryBalance.branch_id, scope),
        )
        .group_by(InventoryBalance.variant_id)
        .subquery()
    )
    return await _rows(
        db,
        select(
            ProductVariant.id.label("variant_id"),
            ProductVariant.sku,
            Product.name.label("product_name"),
            on_hand.c.on_hand,
            func.coalesce(sold.c.sold, 0).label("quantity_sold"),
            (on_hand.c.on_hand * ProductVariant.average_cost).label("stock_value"),
        )
        .join(Product, Product.id == ProductVariant.product_id)
        .join(on_hand, on_hand.c.variant_id == ProductVariant.id)
        .outerjoin(sold, sold.c.variant_id == ProductVariant.id)
        .where(
            ProductVariant.company_id == scope.company_id,
            ProductVariant.is_active.is_(True),
            on_hand.c.on_hand > 0,
        )
        .order_by(
            func.coalesce(sold.c.sold, 0), (on_hand.c.on_hand * ProductVariant.average_cost).desc()
        )
        .limit(limit),
    )


async def products_without_sales(db: AsyncSession, scope: Scope, *, limit: int = 200) -> list[Row]:
    sold_ids = (
        select(SaleItem.variant_id)
        .join(Sale, Sale.id == SaleItem.sale_id)
        .where(*_completed_sales(scope))
    )
    return await _rows(
        db,
        select(
            ProductVariant.id.label("variant_id"),
            ProductVariant.sku,
            Product.name.label("product_name"),
        )
        .join(Product, Product.id == ProductVariant.product_id)
        .where(
            ProductVariant.company_id == scope.company_id,
            ProductVariant.is_active.is_(True),
            Product.is_active.is_(True),
            ProductVariant.id.not_in(sold_ids),
        )
        .order_by(Product.name)
        .limit(limit),
    )


# --- inventory -----------------------------------------------------------------------------


async def inventory_valuation(db: AsyncSession, scope: Scope) -> list[Row]:
    return await _rows(
        db,
        select(
            InventoryBalance.stock_location_id,
            StockLocation.name.label("location"),
            func.count().label("items"),
            func.sum(
                case((InventoryBalance.quantity > 0, InventoryBalance.quantity), else_=0)
            ).label("units"),
            func.sum(
                case(
                    (
                        InventoryBalance.quantity > 0,
                        InventoryBalance.quantity * ProductVariant.average_cost,
                    ),
                    else_=0,
                )
            ).label("value"),
        )
        .join(StockLocation, StockLocation.id == InventoryBalance.stock_location_id)
        .join(ProductVariant, ProductVariant.id == InventoryBalance.variant_id)
        .where(
            InventoryBalance.company_id == scope.company_id,
            *_branch_filter(InventoryBalance.branch_id, scope),
        )
        .group_by(InventoryBalance.stock_location_id, StockLocation.name)
        .order_by(StockLocation.name),
    )


async def stock_levels(
    db: AsyncSession, scope: Scope, *, condition: Literal["low", "out", "negative"]
) -> list[Row]:
    predicate = {
        "low": and_(
            ProductVariant.reorder_point.is_not(None),
            InventoryBalance.quantity > 0,
            InventoryBalance.quantity <= ProductVariant.reorder_point,
        ),
        "out": InventoryBalance.quantity == 0,
        "negative": InventoryBalance.quantity < 0,
    }[condition]
    return await _rows(
        db,
        select(
            InventoryBalance.stock_location_id,
            StockLocation.name.label("location"),
            InventoryBalance.variant_id,
            ProductVariant.sku,
            Product.name.label("product_name"),
            InventoryBalance.quantity,
            ProductVariant.reorder_point,
        )
        .join(StockLocation, StockLocation.id == InventoryBalance.stock_location_id)
        .join(ProductVariant, ProductVariant.id == InventoryBalance.variant_id)
        .join(Product, Product.id == ProductVariant.product_id)
        .where(
            InventoryBalance.company_id == scope.company_id,
            ProductVariant.is_active.is_(True),
            predicate,
            *_branch_filter(InventoryBalance.branch_id, scope),
        )
        .order_by(StockLocation.name, Product.name),
    )


async def inventory_movement_summary(db: AsyncSession, scope: Scope) -> list[Row]:
    return await _rows(
        db,
        select(
            InventoryMovement.movement_type,
            func.count().label("movements"),
            func.sum(InventoryMovement.signed_quantity).label("net_quantity"),
            func.sum(
                InventoryMovement.signed_quantity * func.coalesce(InventoryMovement.unit_cost, 0)
            ).label("value"),
        )
        .where(
            InventoryMovement.company_id == scope.company_id,
            InventoryMovement.occurred_at >= scope.period.start,
            InventoryMovement.occurred_at < scope.period.end,
            *_branch_filter(InventoryMovement.branch_id, scope),
        )
        .group_by(InventoryMovement.movement_type)
        .order_by(InventoryMovement.movement_type),
    )


async def stock_count_variance(db: AsyncSession, scope: Scope) -> list[Row]:
    return await _rows(
        db,
        select(
            StockCount.id.label("stock_count_id"),
            StockCount.number,
            StockCount.completed_at,
            func.count(StockCountLine.id).label("lines"),
            func.sum(func.abs(StockCountLine.variance)).label("absolute_variance_units"),
            func.sum(StockCountLine.variance * ProductVariant.average_cost).label("variance_value"),
        )
        .join(StockCountLine, StockCountLine.stock_count_id == StockCount.id)
        .join(ProductVariant, ProductVariant.id == StockCountLine.variant_id)
        .where(
            StockCount.company_id == scope.company_id,
            StockCount.status == StockCountStatus.COMPLETED,
            StockCount.completed_at >= scope.period.start,
            StockCount.completed_at < scope.period.end,
            *_branch_filter(StockCount.branch_id, scope),
        )
        .group_by(StockCount.id, StockCount.number, StockCount.completed_at)
        .order_by(StockCount.completed_at.desc()),
    )


# --- purchasing, cash, expenses, returns, voids --------------------------------------------


async def purchases_by_supplier(db: AsyncSession, scope: Scope) -> list[Row]:
    return await _rows(
        db,
        select(
            GoodsReceipt.supplier_id,
            Supplier.name.label("supplier"),
            func.count(GoodsReceipt.id).label("receipts"),
            func.sum(GoodsReceipt.total_cost).label("total_cost"),
        )
        .join(Supplier, Supplier.id == GoodsReceipt.supplier_id)
        .where(
            GoodsReceipt.company_id == scope.company_id,
            GoodsReceipt.received_at >= scope.period.start,
            GoodsReceipt.received_at < scope.period.end,
            *_branch_filter(GoodsReceipt.branch_id, scope),
        )
        .group_by(GoodsReceipt.supplier_id, Supplier.name)
        .order_by(func.sum(GoodsReceipt.total_cost).desc()),
    )


async def cash_drawer(db: AsyncSession, scope: Scope) -> list[Row]:
    return await _rows(
        db,
        select(
            CashSession.id.label("cash_session_id"),
            CashSession.branch_id,
            CashSession.device_id,
            User.full_name.label("opened_by"),
            CashSession.opened_at,
            CashSession.closed_at,
            CashSession.opening_float,
            CashSession.expected_cash,
            CashSession.server_expected_cash,
            CashSession.counted_cash,
            CashSession.over_short,
        )
        .join(User, User.id == CashSession.opened_by_id)
        .where(
            CashSession.company_id == scope.company_id,
            CashSession.opened_at >= scope.period.start,
            CashSession.opened_at < scope.period.end,
            *_branch_filter(CashSession.branch_id, scope),
        )
        .order_by(CashSession.opened_at.desc()),
    )


async def expenses_by_category(db: AsyncSession, scope: Scope) -> list[Row]:
    local_from, local_to = scope.period.date_from, scope.period.date_to
    return await _rows(
        db,
        select(
            Expense.category_id,
            ExpenseCategory.name.label("category"),
            func.count(Expense.id).label("entries"),
            func.sum(Expense.amount).label("amount"),
        )
        .join(ExpenseCategory, ExpenseCategory.id == Expense.category_id)
        .where(
            Expense.company_id == scope.company_id,
            Expense.voided_at.is_(None),
            Expense.expense_date >= local_from,
            Expense.expense_date <= local_to,
            *_branch_filter(Expense.branch_id, scope),
        )
        .group_by(Expense.category_id, ExpenseCategory.name)
        .order_by(func.sum(Expense.amount).desc()),
    )


async def returns_report(db: AsyncSession, scope: Scope) -> list[Row]:
    return await _rows(
        db,
        select(
            SaleReturn.id.label("return_id"),
            SaleReturn.return_number,
            SaleReturn.original_sale_id,
            SaleReturn.occurred_at,
            SaleReturn.reason,
            SaleReturn.refund_total,
            User.full_name.label("cashier"),
        )
        .join(User, User.id == SaleReturn.cashier_id)
        .where(*_returns_in_period(scope))
        .order_by(SaleReturn.occurred_at.desc()),
    )


async def voids_report(db: AsyncSession, scope: Scope) -> list[Row]:
    return await _rows(
        db,
        select(
            Sale.id.label("sale_id"),
            Sale.receipt_number,
            Sale.total,
            Sale.voided_at,
            Sale.void_reason,
            User.full_name.label("voided_by"),
            literal("VOIDED").label("status"),
        )
        .join(User, User.id == Sale.voided_by_id)
        .where(
            Sale.company_id == scope.company_id,
            Sale.status == SaleStatus.VOIDED,
            Sale.voided_at >= scope.period.start,
            Sale.voided_at < scope.period.end,
            *_branch_filter(Sale.branch_id, scope),
        )
        .order_by(Sale.voided_at.desc()),
    )


# --- BIR ---------------------------------------------------------------------------------


async def sc_pwd_book(db: AsyncSession, scope: Scope) -> list[Row]:
    """Senior citizen / PWD sales book: one row per sale with a statutory discount."""
    statutory_lines = (
        select(
            SaleItem.sale_id,
            func.sum(SaleItem.gross).label("gross"),
            func.sum(SaleItem.total).label("net"),
        )
        .where(SaleItem.statutory.is_(True))
        .group_by(SaleItem.sale_id)
        .subquery()
    )
    return await _rows(
        db,
        select(
            Sale.occurred_at,
            Sale.receipt_number,
            Sale.statutory_kind.label("kind"),
            Sale.statutory_holder_name.label("holder_name"),
            Sale.statutory_id_number.label("id_number"),
            Sale.statutory_holder_tin.label("holder_tin"),
            statutory_lines.c.gross,
            Sale.vat_exemption_total.label("vat_exemption"),
            Sale.statutory_discount_total.label("discount"),
            statutory_lines.c.net,
        )
        .join(statutory_lines, statutory_lines.c.sale_id == Sale.id)
        .where(*_completed_sales(scope), Sale.statutory_kind.is_not(None))
        .order_by(Sale.occurred_at),
    )


async def terminal_reading(db: AsyncSession, scope: Scope, device_id: uuid.UUID | None) -> Row:
    """X/Z reading of one terminal for the period (BIR-style end-of-day report).

    The accumulated grand totals are running sums of completed sales since the terminal's first
    sale; they never reset, which is what makes them useful for audits.
    """
    if device_id is None:
        raise BusinessRuleError("device_id is required", code="report.device_required")
    in_period = [
        Sale.company_id == scope.company_id,
        Sale.device_id == device_id,
        Sale.occurred_at >= scope.period.start,
        Sale.occurred_at < scope.period.end,
    ]
    completed = [*in_period, Sale.status == SaleStatus.COMPLETED]
    totals = (
        await db.execute(
            select(
                func.count(Sale.id).label("transactions"),
                func.min(Sale.receipt_number).label("first_receipt"),
                func.max(Sale.receipt_number).label("last_receipt"),
                func.coalesce(func.sum(Sale.gross_total), 0).label("gross_sales"),
                func.coalesce(
                    func.sum(Sale.line_discount_total + Sale.order_discount_total), 0
                ).label("regular_discounts"),
                func.coalesce(func.sum(Sale.statutory_discount_total), 0).label("sc_pwd_discounts"),
                func.coalesce(func.sum(Sale.vat_exemption_total), 0).label("vat_exemptions"),
                func.coalesce(func.sum(Sale.total), 0).label("net_sales"),
                func.coalesce(func.sum(Sale.vatable_sales), 0).label("vatable_sales"),
                func.coalesce(func.sum(Sale.vat_amount), 0).label("vat_amount"),
                func.coalesce(func.sum(Sale.exempt_sales), 0).label("vat_exempt_sales"),
                func.coalesce(func.sum(Sale.zero_rated_sales), 0).label("zero_rated_sales"),
            ).where(*completed)
        )
    ).one()
    voids = (
        await db.execute(
            select(func.count(Sale.id), func.coalesce(func.sum(Sale.total), 0)).where(
                *in_period, Sale.status == SaleStatus.VOIDED
            )
        )
    ).one()
    refunds = await db.scalar(
        select(func.coalesce(func.sum(SaleReturn.refund_total), 0)).where(
            SaleReturn.company_id == scope.company_id,
            SaleReturn.device_id == device_id,
            SaleReturn.occurred_at >= scope.period.start,
            SaleReturn.occurred_at < scope.period.end,
        )
    )
    payments = await _rows(
        db,
        select(Payment.method_kind, func.sum(Payment.amount).label("amount"))
        .join(Sale, Sale.id == Payment.sale_id)
        .where(*completed, Payment.status == PaymentStatus.CAPTURED)
        .group_by(Payment.method_kind)
        .order_by(Payment.method_kind),
    )

    def grand_total(before: Any) -> Any:
        return select(func.coalesce(func.sum(Sale.total), 0)).where(
            Sale.company_id == scope.company_id,
            Sale.device_id == device_id,
            Sale.status == SaleStatus.COMPLETED,
            Sale.occurred_at < before,
        )

    old_grand = _d(await db.scalar(grand_total(scope.period.start)))
    new_grand = _d(await db.scalar(grand_total(scope.period.end)))
    return {
        "device_id": str(device_id),
        "transactions": int(totals.transactions),
        "first_receipt": totals.first_receipt,
        "last_receipt": totals.last_receipt,
        "gross_sales": _d(totals.gross_sales),
        "regular_discounts": _d(totals.regular_discounts),
        "sc_pwd_discounts": _d(totals.sc_pwd_discounts),
        "vat_exemptions": _d(totals.vat_exemptions),
        "returns": _d(refunds),
        "voids_count": int(voids[0]),
        "voids_amount": _d(voids[1]),
        "net_sales": _d(totals.net_sales),
        "vatable_sales": _d(totals.vatable_sales),
        "vat_amount": _d(totals.vat_amount),
        "vat_exempt_sales": _d(totals.vat_exempt_sales),
        "zero_rated_sales": _d(totals.zero_rated_sales),
        "payments": payments,
        "old_accumulated_grand_total": old_grand,
        "new_accumulated_grand_total": new_grand,
    }
