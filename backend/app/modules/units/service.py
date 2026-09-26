import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.units.models import DEFAULT_UNITS, Unit
from app.modules.units.schemas import UnitCreate, UnitUpdate
from app.modules.users.permissions import P
from app.shared import crud

LABEL = "unit"


def seed_default_units(db: AsyncSession, company_id: uuid.UUID) -> None:
    for code, (name, allows_decimal) in DEFAULT_UNITS.items():
        db.add(Unit(company_id=company_id, code=code, name=name, allows_decimal=allows_decimal))


async def list_units(
    db: AsyncSession, company_id: uuid.UUID, *, include_inactive: bool
) -> list[Unit]:
    stmt = select(Unit).where(Unit.company_id == company_id)
    if not include_inactive:
        stmt = stmt.where(Unit.is_active.is_(True))
    return list(await db.scalars(stmt.order_by(Unit.code)))


async def create_unit(
    db: AsyncSession, principal: Principal, data: UnitCreate, actor: AuditActor
) -> Unit:
    principal.require(P.PRODUCTS_WRITE)
    await crud.ensure_unique(
        db,
        select(Unit.id).where(Unit.company_id == principal.company_id, Unit.code == data.code),
        LABEL,
        "code",
    )
    return await crud.create_entity(
        db, Unit(company_id=principal.company_id, **data.model_dump()), actor, LABEL
    )


async def update_unit(
    db: AsyncSession, principal: Principal, unit_id: uuid.UUID, data: UnitUpdate, actor: AuditActor
) -> Unit:
    principal.require(P.PRODUCTS_WRITE)
    unit = await crud.get_scoped(db, Unit, principal.company_id, unit_id, LABEL)
    return await crud.update_entity(db, unit, data.model_dump(exclude_unset=True), actor, LABEL)
