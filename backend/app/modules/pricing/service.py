"""Tax rates, price levels and prices."""

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.branches.models import Branch
from app.modules.pricing.models import (
    DEFAULT_PRICE_LEVELS,
    DEFAULT_TAX_RATES,
    Price,
    PriceLevel,
    TaxRate,
)
from app.modules.pricing.schemas import (
    PriceIn,
    PriceLevelCreate,
    PriceLevelUpdate,
    TaxRateCreate,
    TaxRateUpdate,
)
from app.modules.products.models import ProductUnit, ProductVariant
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.exceptions import BusinessRuleError, NotFoundError

# --- Seeding -----------------------------------------------------------------------------


def seed_defaults(db: AsyncSession, company_id: uuid.UUID) -> None:
    for code, (name, rate, kind, is_default) in DEFAULT_TAX_RATES.items():
        db.add(
            TaxRate(
                company_id=company_id,
                code=code,
                name=name,
                rate=rate,
                kind=kind,
                is_default=is_default,
            )
        )
    for i, (code, (name, is_default)) in enumerate(DEFAULT_PRICE_LEVELS.items()):
        db.add(
            PriceLevel(
                company_id=company_id, code=code, name=name, is_default=is_default, sort_order=i
            )
        )


# --- Tax rates ---------------------------------------------------------------------------


async def list_tax_rates(db: AsyncSession, company_id: uuid.UUID) -> list[TaxRate]:
    return list(
        await db.scalars(
            select(TaxRate).where(TaxRate.company_id == company_id).order_by(TaxRate.code)
        )
    )


async def default_tax_rate(db: AsyncSession, company_id: uuid.UUID) -> TaxRate:
    rate = await db.scalar(
        select(TaxRate).where(TaxRate.company_id == company_id, TaxRate.is_default.is_(True))
    )
    if rate is None:
        raise BusinessRuleError("No default tax rate configured", code="tax_rate.no_default")
    return rate


async def create_tax_rate(
    db: AsyncSession, principal: Principal, data: TaxRateCreate, actor: AuditActor
) -> TaxRate:
    principal.require(P.SETTINGS_MANAGE)
    await crud.ensure_unique(
        db,
        select(TaxRate.id).where(
            TaxRate.company_id == principal.company_id, TaxRate.code == data.code
        ),
        "tax_rate",
        "code",
    )
    if data.is_default:
        await _clear_default_tax(db, principal.company_id)
    return await crud.create_entity(
        db, TaxRate(company_id=principal.company_id, **data.model_dump()), actor, "tax_rate"
    )


async def update_tax_rate(
    db: AsyncSession,
    principal: Principal,
    tax_rate_id: uuid.UUID,
    data: TaxRateUpdate,
    actor: AuditActor,
) -> TaxRate:
    principal.require(P.SETTINGS_MANAGE)
    rate = await crud.get_scoped(db, TaxRate, principal.company_id, tax_rate_id, "tax_rate")
    values = data.model_dump(exclude_unset=True)
    if values.get("is_default") is False and rate.is_default:
        raise BusinessRuleError(
            "Make another tax rate the default instead", code="tax_rate.default_required"
        )
    if values.get("is_default") and not rate.is_default:
        await _clear_default_tax(db, principal.company_id)
    return await crud.update_entity(db, rate, values, actor, "tax_rate")


async def _clear_default_tax(db: AsyncSession, company_id: uuid.UUID) -> None:
    await db.execute(
        update(TaxRate)
        .where(TaxRate.company_id == company_id, TaxRate.is_default.is_(True))
        .values(is_default=False)
    )


# --- Price levels ------------------------------------------------------------------------


async def list_price_levels(db: AsyncSession, company_id: uuid.UUID) -> list[PriceLevel]:
    return list(
        await db.scalars(
            select(PriceLevel)
            .where(PriceLevel.company_id == company_id)
            .order_by(PriceLevel.sort_order, PriceLevel.code)
        )
    )


async def default_price_level(db: AsyncSession, company_id: uuid.UUID) -> PriceLevel:
    level = await db.scalar(
        select(PriceLevel).where(
            PriceLevel.company_id == company_id, PriceLevel.is_default.is_(True)
        )
    )
    if level is None:
        raise BusinessRuleError("No default price level configured", code="price_level.no_default")
    return level


async def create_price_level(
    db: AsyncSession, principal: Principal, data: PriceLevelCreate, actor: AuditActor
) -> PriceLevel:
    principal.require(P.PRICES_WRITE)
    await crud.ensure_unique(
        db,
        select(PriceLevel.id).where(
            PriceLevel.company_id == principal.company_id, PriceLevel.code == data.code
        ),
        "price_level",
        "code",
    )
    return await crud.create_entity(
        db, PriceLevel(company_id=principal.company_id, **data.model_dump()), actor, "price_level"
    )


async def update_price_level(
    db: AsyncSession,
    principal: Principal,
    level_id: uuid.UUID,
    data: PriceLevelUpdate,
    actor: AuditActor,
) -> PriceLevel:
    principal.require(P.PRICES_WRITE)
    level = await crud.get_scoped(db, PriceLevel, principal.company_id, level_id, "price_level")
    values = data.model_dump(exclude_unset=True)
    if level.is_default and (values.get("is_default") is False or values.get("is_active") is False):
        raise BusinessRuleError(
            "Make another price level the default first", code="price_level.default_required"
        )
    if values.get("is_default") and not level.is_default:
        await db.execute(
            update(PriceLevel)
            .where(PriceLevel.company_id == principal.company_id, PriceLevel.is_default.is_(True))
            .values(is_default=False)
        )
        await db.flush()
    return await crud.update_entity(db, level, values, actor, "price_level")


# --- Prices ------------------------------------------------------------------------------


async def set_variant_prices(
    db: AsyncSession,
    principal: Principal,
    variant: ProductVariant,
    entries: list[PriceIn],
    actor: AuditActor | None,
    *,
    commit: bool = True,
) -> list[Price]:
    """Replace a variant's price list.

    Existing rows are updated in place (same id) and missing ones are deactivated rather than
    deleted, so offline terminals receive the change through the normal pull.
    """
    principal.require(P.PRICES_WRITE)
    # Keyed by units.id: clients refer to units, not to product_units rows.
    units = {
        u.unit_id: u
        for u in await db.scalars(
            select(ProductUnit).where(ProductUnit.product_id == variant.product_id)
        )
    }
    base_unit = next((u for u in units.values() if u.is_base), None)
    if base_unit is None:
        raise BusinessRuleError("Product has no base unit", code="product.no_base_unit")
    await _validate_refs(db, principal.company_id, entries)
    default_level_id = (await default_price_level(db, principal.company_id)).id

    existing = {
        (p.product_unit_id, p.price_level_id, p.branch_id, p.min_quantity): p
        for p in await db.scalars(select(Price).where(Price.variant_id == variant.id))
    }
    kept: list[Price] = []
    seen: set[tuple[object, ...]] = set()
    for entry in entries:
        product_unit = units.get(entry.unit_id) if entry.unit_id else base_unit
        if product_unit is None:
            raise NotFoundError(
                "Unit is not configured for this product", code="product_unit.not_found"
            )
        unit_id = product_unit.id
        level_id = entry.price_level_id or default_level_id
        key = (unit_id, level_id, entry.branch_id, entry.min_quantity)
        if key in seen:
            raise BusinessRuleError(
                "Duplicate price entry",
                code="price.duplicate",
                details={"entry": entry.model_dump(mode="json")},
            )
        seen.add(key)
        row = existing.get(key)
        if row is None:
            row = Price(
                company_id=principal.company_id,
                variant_id=variant.id,
                product_unit_id=unit_id,
                price_level_id=level_id,
                branch_id=entry.branch_id,
                min_quantity=entry.min_quantity,
                price=entry.price,
            )
            db.add(row)
        else:
            row.price = entry.price
            row.is_active = True
        kept.append(row)

    for key, row in existing.items():
        if key not in seen and row.is_active:
            row.is_active = False

    if actor is not None:
        audit.record(
            db,
            actor,
            "prices.updated",
            entity_type="product_variant",
            entity_id=variant.id,
            changes={"prices": [e.model_dump(mode="json") for e in entries]},
        )
    await db.flush()
    if commit:
        await db.commit()
    return kept


async def _validate_refs(db: AsyncSession, company_id: uuid.UUID, entries: list[PriceIn]) -> None:
    level_ids = {e.price_level_id for e in entries if e.price_level_id}
    if level_ids:
        found = set(
            await db.scalars(
                select(PriceLevel.id).where(
                    PriceLevel.company_id == company_id, PriceLevel.id.in_(level_ids)
                )
            )
        )
        if level_ids - found:
            raise NotFoundError("Price level not found", code="price_level.not_found")
    branch_ids = {e.branch_id for e in entries if e.branch_id}
    if branch_ids:
        found = set(
            await db.scalars(
                select(Branch.id).where(Branch.company_id == company_id, Branch.id.in_(branch_ids))
            )
        )
        if branch_ids - found:
            raise NotFoundError("Branch not found", code="branch.not_found")
