"""CSV import and export of the product catalog.

Import columns (header row required; only `name`, `unit` and `price` are mandatory):

    name, sku, barcode, category, brand, unit, price, cost, tax, track_inventory,
    reorder_point, opening_stock

Rows are upserted by SKU: a known SKU updates the product name, base retail price and reorder
point, and adds the barcode if new. Unknown categories/brands are created. `opening_stock` is
posted as INITIAL_STOCK for new products only. Each row succeeds or fails on its own; failures
are reported with their row number.
"""

import csv
import io
import uuid
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.branches.models import StockLocation
from app.modules.brands.models import Brand
from app.modules.catalog_io.models import ImportJob
from app.modules.categories.models import Category
from app.modules.inventory.models import InventoryBalance
from app.modules.inventory.service import StockLine, post_initial_stock
from app.modules.pricing import service as pricing
from app.modules.pricing.models import Price, TaxRate
from app.modules.pricing.schemas import PriceIn
from app.modules.products import service as products
from app.modules.products.models import Barcode, Product, ProductUnit, ProductVariant
from app.modules.products.schemas import BarcodeIn, ProductCreate, VariantIn
from app.modules.units.models import Unit
from app.modules.users.models import User
from app.modules.users.repository import load_permission_scopes
from app.shared import barcodes as bc
from app.shared.exceptions import AppError

log = get_logger(__name__)
MAX_ROWS = 20_000
COLUMNS = [
    "name",
    "sku",
    "barcode",
    "category",
    "brand",
    "unit",
    "price",
    "cost",
    "tax",
    "track_inventory",
    "reorder_point",
    "opening_stock",
]


class ImportRow(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    sku: str | None = Field(default=None, max_length=64)
    barcode: str | None = Field(default=None, max_length=64)
    category: str | None = Field(default=None, max_length=100)
    brand: str | None = Field(default=None, max_length=100)
    unit: str = Field(min_length=1, max_length=16)
    price: Decimal = Field(ge=0, max_digits=14, decimal_places=2)
    cost: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=4)
    tax: str | None = None
    track_inventory: bool = True
    reorder_point: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=3)
    opening_stock: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=3)

    @field_validator("*", mode="before")
    @classmethod
    def _blank_to_none(cls, value: Any) -> Any:
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value

    @field_validator("unit", "tax", mode="after")
    @classmethod
    def _upper(cls, value: str | None) -> str | None:
        return value.upper() if value else value

    @field_validator("track_inventory", mode="before")
    @classmethod
    def _bool(cls, value: Any) -> Any:
        if value is None:
            return True
        return str(value).strip().lower() in {"1", "true", "yes", "y"}


async def principal_for(db: AsyncSession, user_id: uuid.UUID) -> Principal:
    user = await db.get(User, user_id)
    assert user is not None  # noqa: S101
    global_perms, branch_perms = await load_permission_scopes(db, user.id)
    return Principal(
        user_id=user.id,
        company_id=user.company_id,
        username=user.username,
        global_permissions=global_perms,
        branch_permissions=branch_perms,
    )


def parse_rows(content: str) -> tuple[list[tuple[int, ImportRow]], list[dict[str, Any]]]:
    reader = csv.DictReader(io.StringIO(content.lstrip("﻿")))  # tolerate Excel's BOM
    headers = {h.strip().lower() for h in reader.fieldnames or []}
    if missing := {"name", "unit", "price"} - headers:
        return [], [{"row": 1, "errors": [f"Missing column(s): {', '.join(sorted(missing))}"]}]
    rows: list[tuple[int, ImportRow]] = []
    errors: list[dict[str, Any]] = []
    for number, raw in enumerate(reader, start=2):  # row 1 is the header
        if number - 1 > MAX_ROWS:
            errors.append({"row": number, "errors": [f"More than {MAX_ROWS} rows"]})
            break
        data = {k.strip().lower(): v for k, v in raw.items() if k}
        try:
            rows.append((number, ImportRow.model_validate(data)))
        except (ValidationError, InvalidOperation) as exc:
            messages = (
                [f"{'.'.join(map(str, e['loc']))}: {e['msg']}" for e in exc.errors()]
                if isinstance(exc, ValidationError)
                else [str(exc)]
            )
            errors.append({"row": number, "errors": messages})
    return rows, errors


async def run_product_import(db: AsyncSession, job_id: uuid.UUID) -> None:
    job = await db.get(ImportJob, job_id)
    if job is None or job.status not in ("PENDING", "FAILED"):
        return  # already processed (task redelivered)
    job.status = "RUNNING"
    await db.commit()
    try:
        result = await _import_products(db, job)
        job = await db.get(ImportJob, job_id)
        assert job is not None  # noqa: S101
        job.result = result
        job.status = "DONE"
    except Exception as exc:
        log.exception("import.failed", job_id=str(job_id))
        await db.rollback()
        job = await db.get(ImportJob, job_id)
        assert job is not None  # noqa: S101
        job.status = "FAILED"
        job.error = str(exc)[:1000]
    job.finished_at = datetime.now(UTC)
    await db.commit()


async def _import_products(db: AsyncSession, job: ImportJob) -> dict[str, Any]:
    # Rows roll back individually, which expires ORM objects: read the job's fields once.
    filename, options, content = job.filename, dict(job.options), job.content
    principal = await principal_for(db, job.requested_by_id)
    company_id = principal.company_id
    actor = AuditActor(company_id=company_id, user_id=principal.user_id)
    rows, errors = parse_rows(content)

    units = {
        u.code: u.id for u in await db.scalars(select(Unit).where(Unit.company_id == company_id))
    }
    taxes = {
        t.code: t.id
        for t in await db.scalars(select(TaxRate).where(TaxRate.company_id == company_id))
    }
    categories = {
        c.name.lower(): c.id
        for c in await db.scalars(
            select(Category).where(Category.company_id == company_id, Category.parent_id.is_(None))
        )
    }
    brands = {
        b.name.lower(): b.id
        for b in await db.scalars(select(Brand).where(Brand.company_id == company_id))
    }
    location_id = (
        uuid.UUID(options["stock_location_id"]) if options.get("stock_location_id") else None
    )

    created = updated = 0
    opening: list[StockLine] = []
    for number, row in rows:
        try:
            if row.unit not in units:
                raise ValueError(f"Unknown unit '{row.unit}'")
            if row.tax and row.tax not in taxes:
                raise ValueError(f"Unknown tax code '{row.tax}'")
            category_id = await _ensure_named(db, company_id, categories, Category, row.category)
            brand_id = await _ensure_named(db, company_id, brands, Brand, row.brand)
            existing = (
                await db.scalar(
                    select(ProductVariant).where(
                        ProductVariant.company_id == company_id, ProductVariant.sku == row.sku
                    )
                )
                if row.sku
                else None
            )
            if existing is not None:
                await _update_existing(db, principal, existing, row, category_id, brand_id)
                updated += 1
            else:
                product = await products.create_product(
                    db,
                    principal,
                    ProductCreate(
                        name=row.name,
                        category_id=category_id,
                        brand_id=brand_id,
                        base_unit_id=units[row.unit],
                        tax_rate_id=taxes[row.tax] if row.tax else None,
                        track_inventory=row.track_inventory,
                        variants=[
                            VariantIn(
                                sku=row.sku,
                                cost=row.cost,
                                reorder_point=row.reorder_point,
                                barcodes=[BarcodeIn(code=row.barcode, is_primary=True)]
                                if row.barcode
                                else [],
                                prices=[PriceIn(price=row.price)],
                            )
                        ],
                    ),
                    actor,
                )
                created += 1
                if row.opening_stock and row.track_inventory:
                    opening.append(StockLine(product.variants[0].id, row.opening_stock, row.cost))
        except (AppError, ValueError, ValidationError) as exc:
            await db.rollback()
            message = exc.message if isinstance(exc, AppError) else str(exc)
            errors.append({"row": number, "errors": [message]})

    stock_posted = 0
    if opening:
        if location_id is None:
            location_id = await db.scalar(
                select(StockLocation.id)
                .where(StockLocation.company_id == company_id, StockLocation.is_default.is_(True))
                .limit(1)
            )
        if location_id is not None:
            result = await post_initial_stock(
                db, principal, location_id, opening, f"Import {filename}", actor
            )
            stock_posted = len(result.movements)
    errors.sort(key=lambda e: e["row"])
    return {
        "rows": len(rows) + len([e for e in errors if e["row"] > 1]),
        "created": created,
        "updated": updated,
        "opening_stock_lines": stock_posted,
        "errors": errors[:500],
        "error_count": len(errors),
    }


async def _ensure_named(
    db: AsyncSession,
    company_id: uuid.UUID,
    cache: dict[str, uuid.UUID],
    model: type[Category] | type[Brand],
    name: str | None,
) -> uuid.UUID | None:
    if not name:
        return None
    key = name.lower()
    if key not in cache:
        obj = model(company_id=company_id, name=name)
        db.add(obj)
        # Committed right away: a later failure in the same row rolls back, and the cached id
        # must still exist for the rows that follow.
        await db.commit()
        cache[key] = obj.id
    return cache[key]


async def _update_existing(
    db: AsyncSession,
    principal: Principal,
    variant: ProductVariant,
    row: ImportRow,
    category_id: uuid.UUID | None,
    brand_id: uuid.UUID | None,
) -> None:
    product = await db.get(Product, variant.product_id)
    assert product is not None  # noqa: S101
    product.name = row.name
    product.category_id = category_id or product.category_id
    product.brand_id = brand_id or product.brand_id
    if row.reorder_point is not None:
        variant.reorder_point = row.reorder_point
    # Replace only the base retail price; other price tiers are left untouched.
    level = await pricing.default_price_level(db, principal.company_id)
    base_unit = await db.scalar(
        select(ProductUnit).where(
            ProductUnit.product_id == product.id, ProductUnit.is_base.is_(True)
        )
    )
    assert base_unit is not None  # noqa: S101
    price = await db.scalar(
        select(Price).where(
            Price.variant_id == variant.id,
            Price.product_unit_id == base_unit.id,
            Price.price_level_id == level.id,
            Price.branch_id.is_(None),
            Price.min_quantity == 1,
        )
    )
    if price is None:
        db.add(
            Price(
                company_id=principal.company_id,
                variant_id=variant.id,
                product_unit_id=base_unit.id,
                price_level_id=level.id,
                price=row.price,
            )
        )
    else:
        price.price = row.price
        price.is_active = True
    if row.barcode:
        code = bc.canonicalize(row.barcode)
        if not await db.scalar(
            select(Barcode.id).where(
                Barcode.company_id == principal.company_id, Barcode.code == code
            )
        ):
            db.add(
                Barcode(
                    company_id=principal.company_id,
                    variant_id=variant.id,
                    product_unit_id=base_unit.id,
                    code=code,
                    symbology=bc.detect_symbology(code).value,
                )
            )
    await db.commit()


async def export_products_csv(db: AsyncSession, principal: Principal, *, include_cost: bool) -> str:
    level = await pricing.default_price_level(db, principal.company_id)
    on_hand = (
        select(InventoryBalance.variant_id, func.sum(InventoryBalance.quantity).label("qty"))
        .where(InventoryBalance.company_id == principal.company_id)
        .group_by(InventoryBalance.variant_id)
        .subquery()
    )
    primary_barcode = (
        select(Barcode.code)
        .where(Barcode.variant_id == ProductVariant.id, Barcode.is_active.is_(True))
        .order_by(Barcode.is_primary.desc(), Barcode.code)
        .limit(1)
        .scalar_subquery()
    )
    base_price = (
        select(Price.price)
        .join(ProductUnit, ProductUnit.id == Price.product_unit_id)
        .where(
            Price.variant_id == ProductVariant.id,
            Price.price_level_id == level.id,
            Price.branch_id.is_(None),
            Price.min_quantity == 1,
            Price.is_active.is_(True),
            ProductUnit.is_base.is_(True),
        )
        .limit(1)
        .scalar_subquery()
    )
    rows = await db.execute(
        select(
            Product.name,
            ProductVariant.sku,
            primary_barcode.label("barcode"),
            Category.name.label("category"),
            Brand.name.label("brand"),
            Unit.code.label("unit"),
            base_price.label("price"),
            ProductVariant.average_cost.label("cost"),
            TaxRate.code.label("tax"),
            Product.track_inventory,
            ProductVariant.reorder_point,
            on_hand.c.qty.label("on_hand"),
        )
        .join(Product, Product.id == ProductVariant.product_id)
        .join(Unit, Unit.id == Product.base_unit_id)
        .join(TaxRate, TaxRate.id == Product.tax_rate_id)
        .outerjoin(Category, Category.id == Product.category_id)
        .outerjoin(Brand, Brand.id == Product.brand_id)
        .outerjoin(on_hand, on_hand.c.variant_id == ProductVariant.id)
        .where(
            ProductVariant.company_id == principal.company_id, ProductVariant.is_active.is_(True)
        )
        .order_by(Product.name, ProductVariant.sku)
    )
    buffer = io.StringIO()
    fields = [c for c in [*COLUMNS[:-1], "on_hand"] if include_cost or c != "cost"]
    writer = csv.DictWriter(buffer, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for r in rows.mappings():
        writer.writerow({k: ("" if r[k] is None else str(r[k])) for k in fields})
    return buffer.getvalue()
