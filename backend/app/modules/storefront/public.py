"""Public (anonymous) catalog queries.

Everything here is scoped by the store's slug → company, and only ever touches products that are
`show_online AND is_active`. Unknown, disabled and unpublished all look the same (404), so the
public cannot probe which stores or products exist.

Stock ("real-time" as of the terminals' last sync) is the sum of `inventory_balances` over the
branch's sellable locations (store floor + backroom; warehouses excluded). Negative balances,
which the offline-first design allows, are shown as out of stock.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal

from sqlalchemy import Select, Subquery, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.modules.branches.models import Branch, LocationType, StockLocation
from app.modules.brands.models import Brand
from app.modules.categories.models import Category
from app.modules.companies.features import Feature
from app.modules.companies.models import Company
from app.modules.devices.models import Device, DeviceStatus
from app.modules.inventory.models import InventoryBalance
from app.modules.pricing import service as pricing
from app.modules.pricing.models import Price
from app.modules.pricing.resolver import PriceCandidate, resolve_price
from app.modules.products.models import Product, ProductUnit, ProductVariant
from app.modules.storefront.models import StockDisplay, Storefront
from app.modules.storefront.schemas import (
    Availability,
    PublicBranch,
    PublicCategory,
    PublicProduct,
    PublicProductDetail,
    PublicProductPage,
    PublicStore,
    PublicVariant,
)
from app.modules.units.models import Unit
from app.shared.exceptions import NotFoundError

SELLABLE_LOCATIONS = (LocationType.STORE, LocationType.BACKROOM)
_RANK = {Availability.OUT_OF_STOCK: 0, Availability.LOW_STOCK: 1, Availability.IN_STOCK: 2}


@dataclass(frozen=True, slots=True)
class Store:
    storefront: Storefront
    company: Company


def _not_found() -> NotFoundError:
    return NotFoundError("Store not found", code="store.not_found")


async def resolve_store(db: AsyncSession, slug: str) -> Store:
    row = (
        await db.execute(
            select(Storefront, Company)
            .join(Company, Company.id == Storefront.company_id)
            .where(
                Storefront.slug == slug.lower(),
                Storefront.enabled.is_(True),
                Company.is_active.is_(True),
            )
        )
    ).first()
    # The owner switched the whole feature off: the link disappears like a disabled catalog.
    if row is None or not row[1].has_feature(Feature.ONLINE_CATALOG):
        raise _not_found()
    return Store(storefront=row[0], company=row[1])


def stock_display(store: Store) -> StockDisplay:
    """What the public sees about stock; nothing when the business doesn't track stock."""
    if not store.company.has_feature(Feature.INVENTORY):
        return StockDisplay.HIDDEN
    return StockDisplay(store.storefront.stock_display)


def _published(company_id: uuid.UUID) -> Select[Product]:
    return select(Product).where(
        Product.company_id == company_id,
        Product.show_online.is_(True),
        Product.is_active.is_(True),
        exists().where(ProductVariant.product_id == Product.id, ProductVariant.is_active.is_(True)),
    )


async def _branches(db: AsyncSession, store: Store) -> list[PublicBranch]:
    ids = store.storefront.branch_ids
    if not ids:
        return []
    branches = {
        b.id: b
        for b in await db.scalars(
            select(Branch).where(
                Branch.company_id == store.company.id,
                Branch.id.in_(ids),
                Branch.is_active.is_(True),
            )
        )
    }
    synced: dict[uuid.UUID, datetime | None] = {
        branch_id: at
        for branch_id, at in (
            await db.execute(
                select(Device.branch_id, func.max(Device.last_sync_at))
                .where(Device.branch_id.in_(branches), Device.status == DeviceStatus.ACTIVE)
                .group_by(Device.branch_id)
            )
        ).all()
    }
    return [
        PublicBranch(
            id=b.id, name=b.name, address=b.address, phone=b.phone, synced_at=synced.get(b.id)
        )
        for bid in ids
        if (b := branches.get(bid)) is not None
    ]


async def store_info(db: AsyncSession, store: Store) -> PublicStore:
    sf, company = store.storefront, store.company
    published = _published(company.id).subquery()
    categories = [
        PublicCategory(id=cid, name=name, product_count=count)
        for cid, name, count in (
            await db.execute(
                select(Category.id, Category.name, func.count(published.c.id))
                .join(published, published.c.category_id == Category.id)
                .where(Category.company_id == company.id, Category.is_active.is_(True))
                .group_by(Category.id, Category.name)
                .order_by(Category.name)
            )
        ).all()
    ]
    return PublicStore(
        slug=sf.slug,
        name=company.name,
        about=sf.about,
        phone=sf.phone,
        messenger_url=sf.messenger_url,
        hours=sf.hours,
        currency=company.currency,
        show_prices=sf.show_prices,
        stock_display=stock_display(store),
        allow_indexing=sf.allow_indexing,
        branches=await _branches(db, store),
        categories=categories,
    )


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _stock_subquery(branch_id: uuid.UUID) -> Subquery:
    return (
        select(
            InventoryBalance.variant_id.label("variant_id"),
            func.sum(InventoryBalance.quantity).label("qty"),
        )
        .join(StockLocation, StockLocation.id == InventoryBalance.stock_location_id)
        .where(
            InventoryBalance.branch_id == branch_id,
            StockLocation.location_type.in_([t.value for t in SELLABLE_LOCATIONS]),
        )
        .group_by(InventoryBalance.variant_id)
        .subquery()
    )


def _pick_branch(branches: list[PublicBranch], branch_id: uuid.UUID | None) -> PublicBranch:
    if not branches:
        raise _not_found()
    if branch_id is None:
        return branches[0]
    for branch in branches:
        if branch.id == branch_id:
            return branch
    raise NotFoundError("Branch not found", code="store.branch_not_found")


def _availability(sf: Storefront, tracked: bool, qty: Decimal) -> Availability:
    if not tracked:
        return Availability.IN_STOCK
    if qty <= 0:
        return Availability.OUT_OF_STOCK
    if qty <= sf.low_stock_threshold:
        return Availability.LOW_STOCK
    return Availability.IN_STOCK


async def _category_with_children(
    db: AsyncSession, company_id: uuid.UUID, category_id: uuid.UUID
) -> list[uuid.UUID]:
    children: dict[uuid.UUID | None, list[uuid.UUID]] = {}
    for cid, parent in (
        await db.execute(
            select(Category.id, Category.parent_id).where(Category.company_id == company_id)
        )
    ).all():
        children.setdefault(parent, []).append(cid)
    found, todo = [], [category_id]
    while todo:
        current = todo.pop()
        found.append(current)
        todo.extend(children.get(current, []))
    return found


async def _names(
    db: AsyncSession,
    id_column: InstrumentedAttribute[uuid.UUID],
    name_column: InstrumentedAttribute[str],
    ids: set[uuid.UUID | None],
) -> dict[uuid.UUID, str]:
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    rows = await db.execute(select(id_column, name_column).where(id_column.in_(wanted)))
    return {row_id: name for row_id, name in rows.all()}


async def _build(
    db: AsyncSession, store: Store, branch_id: uuid.UUID, products: list[Product]
) -> dict[uuid.UUID, tuple[PublicProduct, list[PublicVariant]]]:
    """Cards (and their variants) for `products`, at one branch, honouring the store's settings."""
    sf, company = store.storefront, store.company
    if not products:
        return {}
    ids = [p.id for p in products]
    variants = list(
        await db.scalars(
            select(ProductVariant)
            .where(ProductVariant.product_id.in_(ids), ProductVariant.is_active.is_(True))
            .order_by(ProductVariant.is_default.desc(), ProductVariant.name, ProductVariant.sku)
        )
    )
    variant_ids = [v.id for v in variants]
    stock = _stock_subquery(branch_id)
    quantities: dict[uuid.UUID, Decimal] = {
        vid: qty
        for vid, qty in (
            await db.execute(
                select(stock.c.variant_id, stock.c.qty).where(stock.c.variant_id.in_(variant_ids))
            )
        ).all()
    }

    prices: dict[uuid.UUID, Decimal] = {}
    if sf.show_prices:
        level = await pricing.default_price_level(db, company.id)
        candidates: dict[uuid.UUID, list[PriceCandidate]] = {}
        for price in await db.scalars(
            select(Price)
            .join(ProductUnit, ProductUnit.id == Price.product_unit_id)
            .where(
                Price.variant_id.in_(variant_ids),
                Price.price_level_id == level.id,
                Price.is_active.is_(True),
                Price.min_quantity <= 1,
                or_(Price.branch_id.is_(None), Price.branch_id == branch_id),
                ProductUnit.is_base.is_(True),
            )
        ):
            candidates.setdefault(price.variant_id, []).append(
                PriceCandidate(
                    product_unit_id=price.product_unit_id,
                    price_level_id=price.price_level_id,
                    branch_id=price.branch_id,
                    min_quantity=price.min_quantity,
                    price=price.price,
                )
            )
        for vid, pool in candidates.items():
            chosen = resolve_price(
                pool,
                product_unit_id=pool[0].product_unit_id,  # all are the product's base unit
                price_level_id=level.id,
                default_price_level_id=level.id,
                branch_id=branch_id,
                quantity=Decimal(1),
            )
            if chosen is not None:
                prices[vid] = chosen.price

    brands = await _names(db, Brand.id, Brand.name, {p.brand_id for p in products})
    categories = await _names(db, Category.id, Category.name, {p.category_id for p in products})
    units = await _names(db, Unit.id, Unit.name, {p.base_unit_id for p in products})
    # Measured units (kg, l, …) are shown with their symbol: "2.5 kg left", "₱52.00 / kg".
    symbols = {
        unit_id: code.lower()
        for unit_id, code in (
            await db.execute(
                select(Unit.id, Unit.code).where(
                    Unit.id.in_({p.base_unit_id for p in products}),
                    Unit.allows_decimal.is_(True),
                )
            )
        ).all()
    }

    display = stock_display(store)
    show_stock = display != StockDisplay.HIDDEN
    show_qty = display == StockDisplay.QUANTITY
    by_product: dict[uuid.UUID, list[ProductVariant]] = {}
    for v in variants:
        by_product.setdefault(v.product_id, []).append(v)

    out: dict[uuid.UUID, tuple[PublicProduct, list[PublicVariant]]] = {}
    for p in products:
        public_variants = []
        best = Availability.OUT_OF_STOCK
        total_qty = Decimal(0)
        for v in by_product.get(p.id, []):
            qty = max(Decimal(0), quantities.get(v.id, Decimal(0)))
            availability = _availability(sf, p.track_inventory, qty)
            if _RANK[availability] > _RANK[best]:
                best = availability
            total_qty += qty
            public_variants.append(
                PublicVariant(
                    id=v.id,
                    name=v.name,
                    price=prices.get(v.id),
                    availability=availability if show_stock else None,
                    quantity=qty if show_qty and p.track_inventory else None,
                )
            )
        variant_prices = {pv.price for pv in public_variants if pv.price is not None}
        card = PublicProduct(
            id=p.id,
            name=p.name,
            brand=brands.get(p.brand_id) if p.brand_id else None,
            category=categories.get(p.category_id) if p.category_id else None,
            image_url=p.image_url,
            unit=units.get(p.base_unit_id, ""),
            unit_symbol=symbols.get(p.base_unit_id),
            price=min(variant_prices) if variant_prices else None,
            price_varies=len(variant_prices) > 1,
            availability=best if show_stock else None,
            quantity=total_qty if show_qty and p.track_inventory else None,
            variant_count=len(public_variants),
        )
        out[p.id] = (card, public_variants)
    return out


async def search_products(
    db: AsyncSession,
    store: Store,
    *,
    q: str | None,
    category_id: uuid.UUID | None,
    branch_id: uuid.UUID | None,
    in_stock: bool,
    limit: int,
    offset: int,
) -> PublicProductPage:
    company_id = store.company.id
    branch = _pick_branch(await _branches(db, store), branch_id)
    stmt = _published(company_id)
    if q and q.strip():
        pattern = f"%{_escape_like(q.strip())}%"
        stmt = stmt.where(
            or_(
                Product.name.ilike(pattern, escape="\\"),
                exists().where(
                    Brand.id == Product.brand_id, Brand.name.ilike(pattern, escape="\\")
                ),
            )
        )
    if category_id is not None:
        stmt = stmt.where(
            Product.category_id.in_(await _category_with_children(db, company_id, category_id))
        )
    if in_stock:
        stock = _stock_subquery(branch.id)
        stmt = stmt.where(
            or_(
                Product.track_inventory.is_(False),
                select(ProductVariant.id)
                .join(stock, stock.c.variant_id == ProductVariant.id)
                .where(
                    ProductVariant.product_id == Product.id,
                    ProductVariant.is_active.is_(True),
                    stock.c.qty > 0,
                )
                .exists(),
            )
        )
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    products = list(
        await db.scalars(stmt.order_by(Product.name, Product.id).limit(limit).offset(offset))
    )
    built = await _build(db, store, branch.id, products)
    return PublicProductPage(
        items=[built[p.id][0] for p in products],
        total=total,
        limit=limit,
        offset=offset,
        branch_id=branch.id,
        synced_at=branch.synced_at,
    )


async def product_detail(
    db: AsyncSession, store: Store, product_id: uuid.UUID, branch_id: uuid.UUID | None
) -> PublicProductDetail:
    branch = _pick_branch(await _branches(db, store), branch_id)
    product = await db.scalar(_published(store.company.id).where(Product.id == product_id))
    if product is None:
        raise NotFoundError("Product not found", code="store.product_not_found")
    card, variants = (await _build(db, store, branch.id, [product]))[product.id]
    return PublicProductDetail(
        **card.model_dump(), description=product.description, variants=variants
    )
