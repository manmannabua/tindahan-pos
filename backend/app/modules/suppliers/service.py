import uuid

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.suppliers.models import Supplier
from app.modules.suppliers.schemas import SupplierCreate, SupplierUpdate
from app.modules.users.permissions import P
from app.shared import crud

LABEL = "supplier"
_NULLABLE = {"contact_person", "phone", "email", "address", "tin", "notes"}


async def list_suppliers(
    db: AsyncSession,
    company_id: uuid.UUID,
    *,
    q: str | None,
    include_inactive: bool,
    limit: int,
    offset: int,
) -> tuple[list[Supplier], int]:
    stmt = select(Supplier).where(Supplier.company_id == company_id)
    if not include_inactive:
        stmt = stmt.where(Supplier.is_active.is_(True))
    if q:
        pattern = f"%{q}%"
        stmt = stmt.where(or_(Supplier.name.ilike(pattern), Supplier.code.ilike(pattern)))
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.scalars(stmt.order_by(Supplier.name).limit(limit).offset(offset))
    return list(rows), total


async def create_supplier(
    db: AsyncSession, principal: Principal, data: SupplierCreate, actor: AuditActor
) -> Supplier:
    principal.require(P.SUPPLIERS_MANAGE)
    await crud.ensure_unique(
        db,
        select(Supplier.id).where(
            Supplier.company_id == principal.company_id, Supplier.code == data.code
        ),
        LABEL,
        "code",
    )
    return await crud.create_entity(
        db, Supplier(company_id=principal.company_id, **data.model_dump()), actor, LABEL
    )


async def update_supplier(
    db: AsyncSession,
    principal: Principal,
    supplier_id: uuid.UUID,
    data: SupplierUpdate,
    actor: AuditActor,
) -> Supplier:
    principal.require(P.SUPPLIERS_MANAGE)
    supplier = await crud.get_scoped(db, Supplier, principal.company_id, supplier_id, LABEL)
    return await crud.update_entity(
        db, supplier, data.model_dump(exclude_unset=True), actor, LABEL, nullable=_NULLABLE
    )
