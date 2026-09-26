import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.brands.models import Brand
from app.modules.brands.schemas import BrandCreate, BrandUpdate
from app.modules.users.permissions import P
from app.shared import crud

LABEL = "brand"


async def list_brands(
    db: AsyncSession, company_id: uuid.UUID, *, include_inactive: bool
) -> list[Brand]:
    stmt = select(Brand).where(Brand.company_id == company_id)
    if not include_inactive:
        stmt = stmt.where(Brand.is_active.is_(True))
    return list(await db.scalars(stmt.order_by(Brand.name)))


async def create_brand(
    db: AsyncSession, principal: Principal, data: BrandCreate, actor: AuditActor
) -> Brand:
    principal.require(P.PRODUCTS_WRITE)
    await _ensure_name_free(db, principal.company_id, data.name)
    return await crud.create_entity(
        db, Brand(company_id=principal.company_id, name=data.name), actor, LABEL
    )


async def update_brand(
    db: AsyncSession,
    principal: Principal,
    brand_id: uuid.UUID,
    data: BrandUpdate,
    actor: AuditActor,
) -> Brand:
    principal.require(P.PRODUCTS_WRITE)
    brand = await crud.get_scoped(db, Brand, principal.company_id, brand_id, LABEL)
    if data.name:
        await _ensure_name_free(db, principal.company_id, data.name, exclude_id=brand.id)
    return await crud.update_entity(db, brand, data.model_dump(exclude_unset=True), actor, LABEL)


async def _ensure_name_free(
    db: AsyncSession, company_id: uuid.UUID, name: str, *, exclude_id: uuid.UUID | None = None
) -> None:
    await crud.ensure_unique(
        db,
        select(Brand.id).where(Brand.company_id == company_id, crud.ci_equals(Brand.name, name)),
        LABEL,
        "name",
        exclude_id=exclude_id,
    )
