"""Catalogue of reports: how to run each one and which fields reveal cost/profit.

Cost-revealing fields are removed unless the caller holds `reports.financial` (a cashier-level
manager can see sales but not margins).
"""

import csv
import io
import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.reporting import service as rs
from app.modules.reporting.service import Scope

Runner = Callable[[AsyncSession, Scope, dict[str, Any]], Awaitable[Any]]
COST_FIELDS = frozenset(
    {
        "revenue_ex_tax",
        "cogs",
        "gross_profit",
        "gross_margin_pct",
        "stock_value",
        "value",
        "variance_value",
    }
)


@dataclass(frozen=True, slots=True)
class ReportDef:
    title: str
    run: Runner
    financial: frozenset[str] = field(default_factory=frozenset)


def _simple(fn: Callable[[AsyncSession, Scope], Awaitable[Any]]) -> Runner:
    return lambda db, scope, _options: fn(db, scope)


REPORTS: dict[str, ReportDef] = {
    "sales-summary": ReportDef("Sales summary", _simple(rs.sales_summary), COST_FIELDS),
    "sales-trend": ReportDef(
        "Sales trend", lambda db, s, o: rs.sales_trend(db, s, o.get("granularity") or "day")
    ),
    "sales-by-hour": ReportDef("Sales by hour", _simple(rs.sales_by_hour)),
    "sales-by-product": ReportDef(
        "Sales by product",
        lambda db, s, o: rs.sales_by_product(db, s, limit=o.get("limit") or 50),
        COST_FIELDS,
    ),
    "best-sellers": ReportDef(
        "Best sellers",
        lambda db, s, o: rs.sales_by_product(db, s, order="quantity", limit=o.get("limit") or 20),
        COST_FIELDS,
    ),
    "sales-by-category": ReportDef("Sales by category", _simple(rs.sales_by_category), COST_FIELDS),
    "sales-by-brand": ReportDef("Sales by brand", _simple(rs.sales_by_brand), COST_FIELDS),
    "sales-by-cashier": ReportDef("Sales by cashier", _simple(rs.sales_by_cashier)),
    "sales-by-branch": ReportDef("Sales by branch", _simple(rs.sales_by_branch)),
    "sales-by-payment-method": ReportDef(
        "Sales by payment method", _simple(rs.sales_by_payment_method)
    ),
    "slow-movers": ReportDef(
        "Slow movers",
        lambda db, s, o: rs.slow_movers(db, s, limit=o.get("limit") or 50),
        COST_FIELDS,
    ),
    "no-sales": ReportDef("Products with no sales", _simple(rs.products_without_sales)),
    "inventory-valuation": ReportDef(
        "Inventory valuation", _simple(rs.inventory_valuation), frozenset({"value"})
    ),
    "low-stock": ReportDef("Low stock", lambda db, s, _o: rs.stock_levels(db, s, condition="low")),
    "out-of-stock": ReportDef(
        "Out of stock", lambda db, s, _o: rs.stock_levels(db, s, condition="out")
    ),
    "negative-inventory": ReportDef(
        "Negative inventory", lambda db, s, _o: rs.stock_levels(db, s, condition="negative")
    ),
    "inventory-movements": ReportDef(
        "Inventory movements", _simple(rs.inventory_movement_summary), frozenset({"value"})
    ),
    "stock-count-variance": ReportDef(
        "Stock count variance", _simple(rs.stock_count_variance), frozenset({"variance_value"})
    ),
    "purchases-by-supplier": ReportDef("Purchases by supplier", _simple(rs.purchases_by_supplier)),
    "cash-drawer": ReportDef("Cash drawer / over-short", _simple(rs.cash_drawer)),
    "expenses": ReportDef("Expenses by category", _simple(rs.expenses_by_category)),
    "returns": ReportDef("Returns", _simple(rs.returns_report)),
    "voids": ReportDef("Voids", _simple(rs.voids_report)),
}


def redact(data: Any, hidden: frozenset[str]) -> Any:
    if not hidden:
        return data
    if isinstance(data, list):
        return [redact(row, hidden) for row in data]
    if isinstance(data, dict):
        return {k: v for k, v in data.items() if k not in hidden}
    return data


def _plain(value: Any) -> Any:
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return (
        str(value)
        if value is not None and not isinstance(value, (int, float, str, bool))
        else value
    )


def to_jsonable(data: Any) -> Any:
    if isinstance(data, list):
        return [to_jsonable(row) for row in data]
    if isinstance(data, dict):
        return {k: _plain(v) for k, v in data.items()}
    return _plain(data)


def to_csv(data: Any) -> tuple[str, int]:
    rows = data if isinstance(data, list) else [{"metric": k, "value": v} for k, v in data.items()]
    buffer = io.StringIO()
    if rows:
        writer = csv.DictWriter(buffer, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        for row in rows:
            writer.writerow({k: _plain(v) for k, v in row.items()})
    return buffer.getvalue(), len(rows)


def cache_key(company_id: object, name: str, params: dict[str, Any]) -> str:
    return f"report:{company_id}:{name}:{json.dumps(params, sort_keys=True, default=str)}"
