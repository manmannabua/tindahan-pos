"""Product catalog: products, variants, units and barcodes.

Business-operation API: a product is created in one call together with its units, variants,
barcodes and prices, in one transaction.
"""

import uuid
from decimal import Decimal

from sqlalchemy import Select, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import distinct_on
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.brands.models import Brand
from app.modules.categories.models import Category
from app.modules.pricing import service as pricing
from app.modules.pricing.models import Price, TaxRate
from app.modules.products.models import Barcode, Product, ProductUnit, ProductVariant
from app.modules.products.schemas import (
    BarcodeIn,
    BarcodeUpdate,
    ProductCreate,
    ProductUnitIn,
    ProductUnitUpdate,
    ProductUpdate,
    VariantIn,
    VariantUpdate,
)
from app.modules.units.models import Unit
from app.modules.users.permissions import P
from app.shared import barcodes as bc
from app.shared import crud
from app.shared.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.shared.patch import apply_patch
from app.shared.sequences import next_number


def _product_query(company_id: uuid.UUID) -> Select[Product]:
    return (
        select(Product)
        .where(Product.company_id == company_id)
        .options(
            selectinload(Product.units).selectinload(ProductUnit.unit),
            selectinload(Product.variants).selectinload(ProductVariant.barcodes),
            selectinload(Product.variants).selectinload(ProductVariant.prices),
        )
    )


async def get_product(
    db: AsyncSession, company_id: uuid.UUID, product_id: uuid.UUID, *, fresh: bool = False
) -> Product:
    stmt = _product_query(company_id).where(Product.id == product_id)
    if fresh:
        stmt = stmt.execution_options(populate_existing=True)
    product = await db.scalar(stmt)
    if product is None:
        raise NotFoundError("Product not found", code="product.not_found")
    return product


async def list_products(
    db: AsyncSession,
    company_id: uuid.UUID,
    *,
    q: str | None,
    category_id: uuid.UUID | None,
    brand_id: uuid.UUID | None,
    include_inactive: bool,
    limit: int,
    offset: int,
) -> tuple[list[tuple[Product, int, str | None, str | None, Decimal | None]], int]:
    """Summaries: product, variant count, default SKU, primary barcode, default retail price."""
    stmt = select(Product).where(Product.company_id == company_id)
    if not include_inactive:
        stmt = stmt.where(Product.is_active.is_(True))
    if category_id:
        stmt = stmt.where(Product.category_id == category_id)
    if brand_id:
        stmt = stmt.where(Product.brand_id == brand_id)
    if q:
        pattern = f"%{q.strip()}%"
        code = bc.canonicalize(q)
        stmt = stmt.where(
            or_(
                Product.name.ilike(pattern),
                exists().where(
                    ProductVariant.product_id == Product.id, ProductVariant.sku.ilike(pattern)
                ),
                exists().where(
                    Barcode.variant_id == ProductVariant.id,
                    ProductVariant.product_id == Product.id,
                    Barcode.code == code,
                ),
            )
        )
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    products = list(await db.scalars(stmt.order_by(Product.name).limit(limit).offset(offset)))
    if not products:
        return [], total

    ids = [p.id for p in products]
    default_level = await pricing.default_price_level(db, company_id)
    variant_rows = (
        await db.execute(
            select(
                ProductVariant.product_id,
                ProductVariant.id,
                ProductVariant.sku,
                ProductVariant.is_default,
            ).where(ProductVariant.product_id.in_(ids))
        )
    ).all()
    counts: dict[uuid.UUID, int] = {}
    default_variant: dict[uuid.UUID, tuple[uuid.UUID, str]] = {}
    for product_id, variant_id, sku, is_default in variant_rows:
        counts[product_id] = counts.get(product_id, 0) + 1
        if is_default or product_id not in default_variant:
            default_variant[product_id] = (variant_id, sku)
    variant_ids = [v for v, _ in default_variant.values()]
    barcodes = {
        variant_id: code
        for variant_id, code in (
            await db.execute(
                select(Barcode.variant_id, Barcode.code)
                .where(Barcode.variant_id.in_(variant_ids), Barcode.is_active.is_(True))
                .order_by(Barcode.variant_id, Barcode.is_primary.desc(), Barcode.code)
                .ext(distinct_on(Barcode.variant_id))
            )
        ).all()
    }
    prices = {
        variant_id: price
        for variant_id, price in (
            await db.execute(
                select(Price.variant_id, Price.price)
                .join(ProductUnit, ProductUnit.id == Price.product_unit_id)
                .where(
                    Price.variant_id.in_(variant_ids),
                    Price.price_level_id == default_level.id,
                    Price.branch_id.is_(None),
                    Price.min_quantity == 1,
                    Price.is_active.is_(True),
                    ProductUnit.is_base.is_(True),
                )
            )
        ).all()
    }
    rows = []
    for p in products:
        variant = default_variant.get(p.id)
        vid = variant[0] if variant else None
        rows.append(
            (
                p,
                counts.get(p.id, 0),
                variant[1] if variant else None,
                barcodes.get(vid) if vid else None,
                prices.get(vid) if vid else None,
            )
        )
    return rows, total


async def create_product(
    db: AsyncSession, principal: Principal, data: ProductCreate, actor: AuditActor
) -> Product:
    principal.require(P.PRODUCTS_WRITE)
    if any(v.prices for v in data.variants):
        principal.require(P.PRICES_WRITE)
    company_id = principal.company_id
    await _check_refs(
        db,
        company_id,
        category_id=data.category_id,
        brand_id=data.brand_id,
        unit_ids={data.base_unit_id, *(u.unit_id for u in data.units)},
    )
    tax_rate_id = data.tax_rate_id or (await pricing.default_tax_rate(db, company_id)).id
    if data.tax_rate_id:
        await crud.get_scoped(db, TaxRate, company_id, data.tax_rate_id, "tax_rate")

    product = Product(
        company_id=company_id,
        name=data.name,
        description=data.description,
        category_id=data.category_id,
        brand_id=data.brand_id,
        base_unit_id=data.base_unit_id,
        tax_rate_id=tax_rate_id,
        track_inventory=data.track_inventory,
        image_url=data.image_url,
    )
    db.add(product)
    await db.flush()

    units = [
        ProductUnit(
            company_id=company_id,
            product_id=product.id,
            unit_id=data.base_unit_id,
            factor=Decimal(1),
            is_base=True,
        )
    ]
    units += [
        ProductUnit(
            company_id=company_id, product_id=product.id, unit_id=u.unit_id, factor=u.factor
        )
        for u in data.units
    ]
    db.add_all(units)
    await db.flush()

    for index, variant_in in enumerate(data.variants):
        await _create_variant(db, principal, product, variant_in, is_default=index == 0)

    audit.record(
        db,
        actor,
        "product.created",
        entity_type="product",
        entity_id=product.id,
        metadata={"name": product.name, "variants": len(data.variants)},
    )
    await db.commit()
    return await get_product(db, company_id, product.id, fresh=True)


async def update_product(
    db: AsyncSession,
    principal: Principal,
    product_id: uuid.UUID,
    data: ProductUpdate,
    actor: AuditActor,
) -> Product:
    principal.require(P.PRODUCTS_WRITE)
    product = await crud.get_scoped(db, Product, principal.company_id, product_id, "product")
    values = data.model_dump(exclude_unset=True)
    await _check_refs(
        db,
        principal.company_id,
        category_id=values.get("category_id"),
        brand_id=values.get("brand_id"),
        unit_ids=set(),
    )
    if values.get("tax_rate_id"):
        await crud.get_scoped(db, TaxRate, principal.company_id, values["tax_rate_id"], "tax_rate")
    changes = apply_patch(product, values, {"description", "category_id", "brand_id", "image_url"})
    audit.record(
        db, actor, "product.updated", entity_type="product", entity_id=product.id, changes=changes
    )
    await db.commit()
    return await get_product(db, principal.company_id, product_id, fresh=True)


async def add_unit(
    db: AsyncSession,
    principal: Principal,
    product_id: uuid.UUID,
    data: ProductUnitIn,
    actor: AuditActor,
) -> Product:
    principal.require(P.PRODUCTS_WRITE)
    product = await crud.get_scoped(db, Product, principal.company_id, product_id, "product")
    await _check_refs(db, principal.company_id, unit_ids={data.unit_id})
    exists_row = await db.scalar(
        select(ProductUnit).where(
            ProductUnit.product_id == product.id, ProductUnit.unit_id == data.unit_id
        )
    )
    if exists_row is not None:
        if exists_row.is_active:
            raise ConflictError("Unit already configured", code="product_unit.exists")
        exists_row.is_active = True
        exists_row.factor = data.factor
    else:
        db.add(
            ProductUnit(
                company_id=principal.company_id,
                product_id=product.id,
                unit_id=data.unit_id,
                factor=data.factor,
            )
        )
    audit.record(
        db,
        actor,
        "product.unit_added",
        entity_type="product",
        entity_id=product.id,
        metadata={"unit_id": str(data.unit_id), "factor": str(data.factor)},
    )
    await db.commit()
    return await get_product(db, principal.company_id, product_id, fresh=True)


async def update_unit(
    db: AsyncSession,
    principal: Principal,
    product_unit_id: uuid.UUID,
    data: ProductUnitUpdate,
    actor: AuditActor,
) -> Product:
    principal.require(P.PRODUCTS_WRITE)
    pu = await crud.get_scoped(
        db, ProductUnit, principal.company_id, product_unit_id, "product_unit"
    )
    values = data.model_dump(exclude_unset=True)
    if pu.is_base and (values.get("is_active") is False or "factor" in values):
        raise BusinessRuleError(
            "The base unit cannot be changed or disabled", code="product_unit.base"
        )
    changes = apply_patch(pu, values, set())
    audit.record(
        db,
        actor,
        "product.unit_updated",
        entity_type="product",
        entity_id=pu.product_id,
        changes=changes,
    )
    await db.commit()
    return await get_product(db, principal.company_id, pu.product_id, fresh=True)


async def add_variant(
    db: AsyncSession,
    principal: Principal,
    product_id: uuid.UUID,
    data: VariantIn,
    actor: AuditActor,
) -> Product:
    principal.require(P.PRODUCTS_WRITE)
    if data.prices:
        principal.require(P.PRICES_WRITE)
    product = await crud.get_scoped(db, Product, principal.company_id, product_id, "product")
    variant = await _create_variant(db, principal, product, data, is_default=False)
    audit.record(
        db,
        actor,
        "product.variant_added",
        entity_type="product",
        entity_id=product.id,
        metadata={"variant_id": str(variant.id), "sku": variant.sku},
    )
    await db.commit()
    return await get_product(db, principal.company_id, product_id, fresh=True)


async def update_variant(
    db: AsyncSession,
    principal: Principal,
    variant_id: uuid.UUID,
    data: VariantUpdate,
    actor: AuditActor,
) -> Product:
    principal.require(P.PRODUCTS_WRITE)
    variant = await crud.get_scoped(db, ProductVariant, principal.company_id, variant_id, "variant")
    values = data.model_dump(exclude_unset=True)
    if values.get("sku") and values["sku"] != variant.sku:
        await _ensure_sku_free(db, principal.company_id, values["sku"])
    if variant.is_default and (
        values.get("is_default") is False or values.get("is_active") is False
    ):
        raise BusinessRuleError(
            "Make another variant the default first", code="variant.default_required"
        )
    if values.get("is_default") and not variant.is_default:
        await db.execute(
            update(ProductVariant)
            .where(
                ProductVariant.product_id == variant.product_id, ProductVariant.is_default.is_(True)
            )
            .values(is_default=False)
        )
    changes = apply_patch(variant, values, {"name", "reorder_point"})
    audit.record(
        db,
        actor,
        "product.variant_updated",
        entity_type="product_variant",
        entity_id=variant.id,
        changes=changes,
    )
    await db.commit()
    return await get_product(db, principal.company_id, variant.product_id, fresh=True)


async def add_barcode(
    db: AsyncSession,
    principal: Principal,
    variant_id: uuid.UUID,
    data: BarcodeIn,
    actor: AuditActor,
) -> Barcode:
    principal.require(P.PRODUCTS_WRITE)
    variant = await crud.get_scoped(db, ProductVariant, principal.company_id, variant_id, "variant")
    barcode = await _attach_barcode(db, principal.company_id, variant, data)
    audit.record(
        db,
        actor,
        "product.barcode_added",
        entity_type="product_variant",
        entity_id=variant.id,
        metadata={"code": barcode.code},
    )
    await db.commit()
    return barcode


async def generate_barcode(
    db: AsyncSession,
    principal: Principal,
    variant_id: uuid.UUID,
    unit_id: uuid.UUID | None,
    actor: AuditActor,
) -> Barcode:
    """Assign an internal EAN-13 (prefix 2, restricted circulation)."""
    principal.require(P.PRODUCTS_WRITE)
    variant = await crud.get_scoped(db, ProductVariant, principal.company_id, variant_id, "variant")
    for _ in range(5):  # skip numbers someone entered manually
        code = bc.internal_ean13(await next_number(db, principal.company_id, "internal_barcode"))
        if not await db.scalar(
            select(Barcode.id).where(
                Barcode.company_id == principal.company_id, Barcode.code == code
            )
        ):
            break
    else:  # pragma: no cover - would need 5 consecutive manual collisions
        raise ConflictError("Could not allocate a barcode", code="barcode.allocation_failed")
    barcode = await _attach_barcode(
        db, principal.company_id, variant, BarcodeIn(code=code, unit_id=unit_id)
    )
    audit.record(
        db,
        actor,
        "product.barcode_generated",
        entity_type="product_variant",
        entity_id=variant.id,
        metadata={"code": code},
    )
    await db.commit()
    return barcode


async def update_barcode(
    db: AsyncSession,
    principal: Principal,
    barcode_id: uuid.UUID,
    data: BarcodeUpdate,
    actor: AuditActor,
) -> Barcode:
    principal.require(P.PRODUCTS_WRITE)
    barcode = await crud.get_scoped(db, Barcode, principal.company_id, barcode_id, "barcode")
    values = data.model_dump(exclude_unset=True)
    if "unit_id" in values:
        variant = await crud.get_scoped(
            db, ProductVariant, principal.company_id, barcode.variant_id, "variant"
        )
        barcode.product_unit_id = (
            await _product_unit(db, variant.product_id, values.pop("unit_id"))
        ).id
    if values.get("is_primary"):
        await _clear_primary(db, barcode.variant_id)
    changes = apply_patch(barcode, values, set())
    audit.record(
        db,
        actor,
        "product.barcode_updated",
        entity_type="barcode",
        entity_id=barcode.id,
        changes=changes,
    )
    await db.commit()
    await db.refresh(barcode)
    return barcode


async def lookup_barcode(
    db: AsyncSession, company_id: uuid.UUID, code: str
) -> tuple[Barcode, Product, ProductVariant]:
    """Admin lookup. (The POS never calls this — it looks up barcodes in IndexedDB.)"""
    row = (
        await db.execute(
            select(Barcode, ProductVariant, Product)
            .join(ProductVariant, ProductVariant.id == Barcode.variant_id)
            .join(Product, Product.id == ProductVariant.product_id)
            .where(Barcode.company_id == company_id, Barcode.code == bc.canonicalize(code))
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Barcode not found", code="barcode.not_found")
    barcode, variant, product = row
    return barcode, product, variant


# --- internals ---------------------------------------------------------------------------


async def _create_variant(
    db: AsyncSession, principal: Principal, product: Product, data: VariantIn, *, is_default: bool
) -> ProductVariant:
    company_id = principal.company_id
    sku = data.sku or await _generate_sku(db, company_id)
    await _ensure_sku_free(db, company_id, sku)
    variant = ProductVariant(
        company_id=company_id,
        product_id=product.id,
        sku=sku,
        name=data.name,
        attributes=data.attributes,
        average_cost=data.cost or Decimal(0),
        last_cost=data.cost,
        reorder_point=data.reorder_point,
        is_default=is_default,
    )
    db.add(variant)
    await db.flush()
    for barcode_in in data.barcodes:
        await _attach_barcode(db, company_id, variant, barcode_in)
    if data.prices:
        await pricing.set_variant_prices(db, principal, variant, data.prices, None, commit=False)
    return variant


async def _attach_barcode(
    db: AsyncSession, company_id: uuid.UUID, variant: ProductVariant, data: BarcodeIn
) -> Barcode:
    code = bc.canonicalize(data.code)
    if len(code) < 3:
        raise BusinessRuleError("Barcode is too short", code="barcode.invalid")
    product_unit = await _product_unit(db, variant.product_id, data.unit_id)
    if data.is_primary:
        await _clear_primary(db, variant.id)

    existing = await db.scalar(
        select(Barcode).where(Barcode.company_id == company_id, Barcode.code == code)
    )
    if existing is not None:
        if existing.is_active:
            owner = await db.scalar(
                select(Product.name)
                .join(ProductVariant, ProductVariant.product_id == Product.id)
                .where(ProductVariant.id == existing.variant_id)
            )
            raise ConflictError(
                f"Barcode {code} is already used by '{owner}'",
                code="barcode.taken",
                details={"code": code, "variant_id": str(existing.variant_id)},
            )
        # Reuse the row (see Barcode docstring): terminals see an update, not a new record.
        existing.variant_id = variant.id
        existing.product_unit_id = product_unit.id
        existing.is_active = True
        existing.is_primary = data.is_primary
        await db.flush()
        return existing

    barcode = Barcode(
        company_id=company_id,
        variant_id=variant.id,
        product_unit_id=product_unit.id,
        code=code,
        symbology=bc.detect_symbology(code).value,
        is_primary=data.is_primary,
    )
    db.add(barcode)
    await db.flush()
    return barcode


async def _clear_primary(db: AsyncSession, variant_id: uuid.UUID) -> None:
    await db.execute(
        update(Barcode)
        .where(Barcode.variant_id == variant_id, Barcode.is_primary.is_(True))
        .values(is_primary=False)
    )


async def _product_unit(
    db: AsyncSession, product_id: uuid.UUID, unit_id: uuid.UUID | None
) -> ProductUnit:
    stmt = select(ProductUnit).where(ProductUnit.product_id == product_id)
    stmt = (
        stmt.where(ProductUnit.unit_id == unit_id)
        if unit_id
        else stmt.where(ProductUnit.is_base.is_(True))
    )
    pu = await db.scalar(stmt)
    if pu is None or not pu.is_active:
        raise NotFoundError(
            "Unit is not configured for this product", code="product_unit.not_found"
        )
    return pu


async def _generate_sku(db: AsyncSession, company_id: uuid.UUID) -> str:
    while True:
        sku = f"P{await next_number(db, company_id, 'sku'):06d}"
        if not await db.scalar(
            select(ProductVariant.id).where(
                ProductVariant.company_id == company_id, ProductVariant.sku == sku
            )
        ):
            return sku


async def _ensure_sku_free(db: AsyncSession, company_id: uuid.UUID, sku: str) -> None:
    if await db.scalar(
        select(ProductVariant.id).where(
            ProductVariant.company_id == company_id, ProductVariant.sku == sku
        )
    ):
        raise ConflictError(f"SKU {sku} is already used", code="variant.sku_taken")


async def _check_refs(
    db: AsyncSession,
    company_id: uuid.UUID,
    *,
    category_id: uuid.UUID | None = None,
    brand_id: uuid.UUID | None = None,
    unit_ids: set[uuid.UUID],
) -> None:
    if category_id:
        await crud.get_scoped(db, Category, company_id, category_id, "category")
    if brand_id:
        await crud.get_scoped(db, Brand, company_id, brand_id, "brand")
    if unit_ids:
        found = set(
            await db.scalars(
                select(Unit.id).where(
                    Unit.company_id == company_id, Unit.id.in_(unit_ids), Unit.is_active.is_(True)
                )
            )
        )
        if unit_ids - found:
            raise NotFoundError("Unit not found", code="unit.not_found")
