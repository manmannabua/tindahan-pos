"""Pull: stream changed master data to a terminal. See docs/SYNC_PROTOCOL.md §4.

A pass covers the transaction-id window [lo, hi), where `hi` is the xmin horizon at the start of
the pass: every transaction with a lower id has finished, so no row can appear "behind" the
cursor later. The window is half-open because when the database is idle the horizon equals the
*next* transaction id, so the next write gets exactly `hi` and must be part of the next pass.

Pages walk the tables in a fixed order with a keyset (sync_txid, pk...) cursor. When a pass
finishes, the next cursor starts at `lo = hi`.
"""

import base64
import json
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel
from sqlalchemy import ColumnElement, and_, func, or_, select, text, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.modules.auth.principal import DevicePrincipal
from app.modules.branches.models import Branch, StockLocation
from app.modules.brands.models import Brand
from app.modules.categories.models import Category
from app.modules.companies.models import Company
from app.modules.customers.models import Customer
from app.modules.customers.schemas import CustomerSync
from app.modules.inventory.models import InventoryBalance
from app.modules.payments.models import PaymentMethod
from app.modules.pricing.models import Price, PriceLevel, TaxRate
from app.modules.products.models import Barcode, Product, ProductUnit, ProductVariant
from app.modules.promotions.models import Promotion
from app.modules.promotions.schemas import PromotionRead
from app.modules.sync import pull_schemas as ps
from app.modules.sync.schemas import PullResponse, StaffRead
from app.modules.units.models import Unit
from app.modules.users.models import User
from app.modules.users.permissions import P
from app.modules.users.repository import load_permission_scopes
from app.shared.exceptions import BusinessRuleError

Filter = Callable[[DevicePrincipal], list[ColumnElement[bool]]]


@dataclass(frozen=True, slots=True)
class PullTable:
    name: str
    model: type[Any]
    schema: type[BaseModel]
    keys: tuple[InstrumentedAttribute[Any], ...]
    filters: Filter


def _company(model: Any) -> Filter:
    return lambda d: [model.company_id == d.company_id]


TABLES: list[PullTable] = [
    PullTable(
        "companies", Company, ps.CompanySync, (Company.id,), lambda d: [Company.id == d.company_id]
    ),
    PullTable(
        "branches", Branch, ps.BranchSync, (Branch.id,), lambda d: [Branch.id == d.branch_id]
    ),
    PullTable(
        "stock_locations",
        StockLocation,
        ps.StockLocationSync,
        (StockLocation.id,),
        lambda d: [StockLocation.branch_id == d.branch_id],
    ),
    PullTable("categories", Category, ps.CategorySync, (Category.id,), _company(Category)),
    PullTable("brands", Brand, ps.BrandSync, (Brand.id,), _company(Brand)),
    PullTable("units", Unit, ps.UnitSync, (Unit.id,), _company(Unit)),
    PullTable("tax_rates", TaxRate, ps.TaxRateSync, (TaxRate.id,), _company(TaxRate)),
    PullTable(
        "price_levels", PriceLevel, ps.PriceLevelSync, (PriceLevel.id,), _company(PriceLevel)
    ),
    PullTable(
        "payment_methods",
        PaymentMethod,
        ps.PaymentMethodSync,
        (PaymentMethod.id,),
        _company(PaymentMethod),
    ),
    PullTable("products", Product, ps.ProductSync, (Product.id,), _company(Product)),
    PullTable(
        "product_units", ProductUnit, ps.ProductUnitSync, (ProductUnit.id,), _company(ProductUnit)
    ),
    PullTable(
        "product_variants",
        ProductVariant,
        ps.VariantSync,
        (ProductVariant.id,),
        _company(ProductVariant),
    ),
    PullTable("barcodes", Barcode, ps.BarcodeSync, (Barcode.id,), _company(Barcode)),
    PullTable(
        "prices",
        Price,
        ps.PriceSync,
        (Price.id,),
        lambda d: [
            Price.company_id == d.company_id,
            or_(Price.branch_id.is_(None), Price.branch_id == d.branch_id),
        ],
    ),
    PullTable(
        "inventory_balances",
        InventoryBalance,
        ps.InventoryBalanceSync,
        (InventoryBalance.stock_location_id, InventoryBalance.variant_id),
        lambda d: [InventoryBalance.branch_id == d.branch_id],
    ),
    # Appended in Phase 7 (order only matters within a pass; new tables go last).
    PullTable("customers", Customer, CustomerSync, (Customer.id,), _company(Customer)),
    PullTable("promotions", Promotion, PromotionRead, (Promotion.id,), _company(Promotion)),
]
TABLE_NAMES = [t.name for t in TABLES]


@dataclass(slots=True)
class Cursor:
    lo: int
    hi: int | None = None  # set while a pass is in progress
    table: int = 0
    last: list[str] | None = None  # [sync_txid, *pk] of the last row sent in `table`

    def encode(self) -> str:
        raw = {"lo": self.lo, "hi": self.hi, "t": self.table, "k": self.last}
        return base64.urlsafe_b64encode(json.dumps(raw).encode()).decode()

    @classmethod
    def decode(cls, value: str | None) -> "Cursor":
        if not value:
            return cls(lo=0)
        try:
            raw = json.loads(base64.urlsafe_b64decode(value.encode()))
            return cls(
                lo=int(raw["lo"]), hi=raw.get("hi"), table=int(raw.get("t", 0)), last=raw.get("k")
            )
        except (ValueError, KeyError, TypeError) as exc:
            raise BusinessRuleError("Invalid sync cursor", code="sync.invalid_cursor") from exc


async def xmin_horizon(db: AsyncSession) -> int:
    """Oldest transaction id still in progress. Everything below it is final."""
    value = await db.scalar(text("SELECT pg_snapshot_xmin(pg_current_snapshot())::text::bigint"))
    return int(value)


def _key_values(table: PullTable, row: Any) -> list[str]:
    return [str(row.sync_txid), *(str(getattr(row, k.key)) for k in table.keys)]


def _after(table: PullTable, last: list[str]) -> ColumnElement[bool]:
    cols = [table.model.sync_txid, *table.keys]
    values: list[Any] = [int(last[0])]
    for key, raw in zip(table.keys, last[1:], strict=True):
        values.append(uuid.UUID(raw) if key.type.python_type is uuid.UUID else raw)
    return tuple_(*cols) > tuple_(*values)


async def pull(
    db: AsyncSession, device: DevicePrincipal, cursor_value: str | None, limit: int
) -> PullResponse:
    cursor = Cursor.decode(cursor_value)
    starting_pass = cursor.hi is None
    if starting_pass:
        cursor.hi = await xmin_horizon(db)
        cursor.table, cursor.last = 0, None
    assert cursor.hi is not None  # noqa: S101

    changes: dict[str, list[dict[str, Any]]] = {}
    remaining = limit
    while cursor.table < len(TABLES) and remaining > 0:
        table = TABLES[cursor.table]
        conditions = [
            *table.filters(device),
            table.model.sync_txid >= cursor.lo,
            table.model.sync_txid < cursor.hi,
        ]
        if cursor.last:
            conditions.append(_after(table, cursor.last))
        rows: list[Any] = list(
            await db.scalars(
                select(table.model)
                .where(and_(*conditions))
                .order_by(table.model.sync_txid, *table.keys)
                .limit(remaining)
            )
        )
        if rows:
            changes[table.name] = [
                table.schema.model_validate(r).model_dump(mode="json") for r in rows
            ]
            cursor.last = _key_values(table, rows[-1])
            remaining -= len(rows)
        if remaining > 0:  # table exhausted
            cursor.table += 1
            cursor.last = None

    finished = cursor.table >= len(TABLES)
    counts = (
        await _counts(db, device, cursor.lo, cursor.hi)
        if starting_pass and cursor.lo == 0
        else None
    )
    staff = await staff_snapshot(db, device) if starting_pass else None
    next_cursor = Cursor(lo=cursor.hi) if finished else cursor
    return PullResponse(
        changes=changes,
        staff=staff,
        counts=counts,
        next_cursor=next_cursor.encode(),
        has_more=not finished,
        server_time=datetime.now(UTC),
    )


async def _counts(db: AsyncSession, device: DevicePrincipal, lo: int, hi: int) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in TABLES:
        counts[table.name] = int(
            await db.scalar(
                select(func.count())
                .select_from(table.model)
                .where(
                    *table.filters(device), table.model.sync_txid >= lo, table.model.sync_txid < hi
                )
            )
            or 0
        )
    return counts


async def staff_snapshot(db: AsyncSession, device: DevicePrincipal) -> list[StaffRead]:
    """All company users, with their permissions *in this branch* and offline PIN verifiers.

    Sent as a full snapshot (not incremental) because a permission change happens on roles and
    role assignments, not on the user row. Staff lists are small.
    """
    staff: list[StaffRead] = []
    for user in await db.scalars(
        select(User).where(User.company_id == device.company_id).order_by(User.username)
    ):
        global_perms, branch_perms = await load_permission_scopes(db, user.id)
        permissions = sorted(global_perms | branch_perms.get(device.branch_id, frozenset()))
        can_use_pos = user.is_active and P.POS_ACCESS in permissions
        staff.append(
            StaffRead(
                id=user.id,
                username=user.username,
                full_name=user.full_name,
                is_active=user.is_active,
                can_use_pos=can_use_pos,
                permissions=permissions if can_use_pos else [],
                # Verifiers are only sent for people who may log in on this terminal.
                pin_offline_salt=user.pin_offline_salt if can_use_pos else None,
                pin_offline_verifier=user.pin_offline_verifier if can_use_pos else None,
                pin_offline_iterations=user.pin_offline_iterations if can_use_pos else None,
                pin_updated_at=user.pin_updated_at,
            )
        )
    return staff
