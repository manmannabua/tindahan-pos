"""Owner-side storefront management: catalog settings and which products are shown online."""

import uuid
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.branches.models import Branch
from app.modules.companies.models import Company
from app.modules.products import service as products
from app.modules.products.models import Product
from app.modules.storefront import cache
from app.modules.storefront.models import StockDisplay, Storefront
from app.modules.storefront.schemas import (
    ProductsOnlineUpdate,
    StorefrontRead,
    StorefrontUpdate,
)
from app.modules.users.permissions import P
from app.shared.exceptions import BusinessRuleError, ConflictError
from app.shared.ids import new_id


async def _published_count(db: AsyncSession, company_id: uuid.UUID) -> int:
    return (
        await db.scalar(
            select(func.count()).where(
                Product.company_id == company_id,
                Product.show_online.is_(True),
                Product.is_active.is_(True),
            )
        )
        or 0
    )


def _settings(storefront: Storefront) -> StorefrontUpdate:
    return StorefrontUpdate.model_validate(
        {field: getattr(storefront, field) for field in StorefrontUpdate.model_fields}
    )


def _audit_diff(before: StorefrontUpdate | None, after: StorefrontUpdate) -> dict[str, Any]:
    """{field: [old, new]} as JSON values; compares real values (so 5.000 == 5)."""
    old, new = (before.model_dump() if before else {}), after.model_dump()
    old_json = before.model_dump(mode="json") if before else {}
    new_json = after.model_dump(mode="json")
    return {k: [old_json.get(k), new_json[k]] for k in new if old.get(k) != new[k]}


def _suggest_slug(company: Company) -> str:
    slug = "".join(c if c.isalnum() else "-" for c in company.code.lower()).strip("-")
    return slug if len(slug) >= 3 else f"store-{slug}".strip("-")


async def get_storefront(db: AsyncSession, company_id: uuid.UUID) -> StorefrontRead:
    storefront = await db.scalar(select(Storefront).where(Storefront.company_id == company_id))
    published = await _published_count(db, company_id)
    if storefront is None:
        # Not saved yet: return the defaults the settings form starts from.
        company = await db.get(Company, company_id)
        assert company is not None  # noqa: S101
        branch_ids = list(
            await db.scalars(
                select(Branch.id)
                .where(Branch.company_id == company_id, Branch.is_active.is_(True))
                .order_by(Branch.code)
            )
        )
        return StorefrontRead(
            configured=False,
            slug=_suggest_slug(company),
            enabled=False,
            branch_ids=branch_ids,
            stock_display=StockDisplay.AVAILABILITY,
            low_stock_threshold=Decimal(5),
            show_prices=True,
            allow_indexing=False,
            about=None,
            phone=None,
            messenger_url=None,
            hours=None,
            published_products=published,
        )
    return StorefrontRead.model_validate(
        {
            **{field: getattr(storefront, field) for field in StorefrontUpdate.model_fields},
            "configured": True,
            "published_products": published,
        }
    )


async def save_storefront(
    db: AsyncSession, principal: Principal, data: StorefrontUpdate, actor: AuditActor
) -> StorefrontRead:
    principal.require(P.COMPANY_MANAGE)
    company_id = principal.company_id
    if data.branch_ids:
        known = set(
            await db.scalars(
                select(Branch.id).where(
                    Branch.company_id == company_id,
                    Branch.id.in_(data.branch_ids),
                    Branch.is_active.is_(True),
                )
            )
        )
        if missing := [b for b in data.branch_ids if b not in known]:
            raise BusinessRuleError(
                "Unknown or inactive branch",
                code="storefront.bad_branch",
                details={"ids": [str(m) for m in missing]},
            )
    taken = await db.scalar(
        select(Storefront.id).where(
            Storefront.slug == data.slug, Storefront.company_id != company_id
        )
    )
    if taken is not None:
        raise ConflictError(
            "That link is already used by another store", code="storefront.slug_taken"
        )

    storefront = await db.scalar(select(Storefront).where(Storefront.company_id == company_id))
    before = None
    if storefront is None:
        storefront = Storefront(id=new_id(), company_id=company_id)
        db.add(storefront)
    else:
        before = _settings(storefront)
    changes = _audit_diff(before, data)
    for key, value in data.model_dump().items():
        setattr(storefront, key, value)
    audit.record(
        db,
        actor,
        "storefront.updated",
        entity_type="storefront",
        entity_id=storefront.id,
        changes=changes,
    )
    await db.commit()
    await cache.invalidate(company_id)
    return await get_storefront(db, company_id)


async def set_products_online(
    db: AsyncSession, principal: Principal, data: ProductsOnlineUpdate, actor: AuditActor
) -> int:
    principal.require(P.PRODUCTS_WRITE)
    company_id = principal.company_id
    if data.product_ids is not None:
        target = select(Product.id).where(
            Product.company_id == company_id, Product.id.in_(data.product_ids)
        )
    else:
        assert data.filter is not None  # noqa: S101 (validated by the schema)
        target = products.filtered_products(
            company_id,
            q=data.filter.q,
            category_id=data.filter.category_id,
            brand_id=data.filter.brand_id,
            include_inactive=data.filter.include_inactive,
            online=data.filter.online,
        ).with_only_columns(Product.id)
    result = await db.execute(
        update(Product)
        .where(Product.id.in_(target), Product.show_online.is_not(data.show_online))
        .values(show_online=data.show_online)
        .returning(Product.id)
        .execution_options(synchronize_session=False)
    )
    changed = [row[0] for row in result]
    if changed:
        audit.record(
            db,
            actor,
            "product.show_online_changed",
            entity_type="product",
            metadata={
                "show_online": data.show_online,
                "count": len(changed),
                "product_ids": [str(i) for i in changed[:200]],
            },
        )
    await db.commit()
    if changed:
        await cache.invalidate(company_id)
    return len(changed)
