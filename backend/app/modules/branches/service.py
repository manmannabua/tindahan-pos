"""Branches and stock locations."""

import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.branches.models import Branch, LocationType, StockLocation
from app.modules.branches.schemas import (
    BranchCreate,
    BranchUpdate,
    StockLocationCreate,
    StockLocationUpdate,
)
from app.modules.users.permissions import P
from app.shared.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.shared.patch import apply_patch

# Fields that may be explicitly cleared by sending null.
_NULLABLE_BRANCH_FIELDS = {"address", "phone", "tin", "receipt_header", "receipt_footer"}


async def list_branches(
    db: AsyncSession, principal: Principal, *, include_inactive: bool = False
) -> list[Branch]:
    stmt = select(Branch).where(Branch.company_id == principal.company_id).order_by(Branch.code)
    if not include_inactive:
        stmt = stmt.where(Branch.is_active.is_(True))
    return list(await db.scalars(stmt))


async def get_branch(
    db: AsyncSession, company_id: uuid.UUID, branch_id: uuid.UUID, *, with_locations: bool = False
) -> Branch:
    stmt = select(Branch).where(Branch.company_id == company_id, Branch.id == branch_id)
    if with_locations:
        stmt = stmt.options(selectinload(Branch.locations))
    branch = await db.scalar(stmt)
    if branch is None:
        raise NotFoundError("Branch not found", code="branch.not_found")
    return branch


async def create_branch(
    db: AsyncSession, principal: Principal, data: BranchCreate, actor: AuditActor
) -> Branch:
    principal.require(P.BRANCHES_MANAGE)
    await _ensure_branch_code_free(db, principal.company_id, data.code)
    branch = Branch(company_id=principal.company_id, **data.model_dump())
    db.add(branch)
    await db.flush()
    # Every branch needs somewhere to sell from.
    db.add(
        StockLocation(
            company_id=principal.company_id,
            branch_id=branch.id,
            code="STORE",
            name=f"{branch.name} - Store",
            location_type=LocationType.STORE,
            is_default=True,
        )
    )
    audit.record(
        db,
        actor,
        "branch.created",
        entity_type="branch",
        entity_id=branch.id,
        branch_id=branch.id,
        metadata={"code": branch.code},
    )
    await db.commit()
    return await get_branch(db, principal.company_id, branch.id, with_locations=True)


async def update_branch(
    db: AsyncSession,
    principal: Principal,
    branch_id: uuid.UUID,
    data: BranchUpdate,
    actor: AuditActor,
) -> Branch:
    principal.require(P.BRANCHES_MANAGE, branch_id)
    branch = await get_branch(db, principal.company_id, branch_id)
    changes = apply_patch(branch, data.model_dump(exclude_unset=True), _NULLABLE_BRANCH_FIELDS)
    audit.record(
        db,
        actor,
        "branch.updated",
        entity_type="branch",
        entity_id=branch.id,
        branch_id=branch.id,
        changes=changes,
    )
    await db.commit()
    return await get_branch(db, principal.company_id, branch.id, with_locations=True)


async def create_location(
    db: AsyncSession,
    principal: Principal,
    branch_id: uuid.UUID,
    data: StockLocationCreate,
    actor: AuditActor,
) -> StockLocation:
    principal.require(P.BRANCHES_MANAGE, branch_id)
    branch = await get_branch(db, principal.company_id, branch_id)
    exists = await db.scalar(
        select(StockLocation.id).where(
            StockLocation.branch_id == branch.id, StockLocation.code == data.code
        )
    )
    if exists:
        raise ConflictError("Location code already used in this branch", code="location.code_taken")
    if data.is_default:
        await _clear_default(db, branch.id)
    location = StockLocation(
        company_id=principal.company_id, branch_id=branch.id, **data.model_dump()
    )
    db.add(location)
    await db.flush()
    audit.record(
        db,
        actor,
        "stock_location.created",
        entity_type="stock_location",
        entity_id=location.id,
        branch_id=branch.id,
        metadata={"code": location.code},
    )
    await db.commit()
    return location


async def update_location(
    db: AsyncSession,
    principal: Principal,
    location_id: uuid.UUID,
    data: StockLocationUpdate,
    actor: AuditActor,
) -> StockLocation:
    location = await db.scalar(
        select(StockLocation).where(
            StockLocation.company_id == principal.company_id, StockLocation.id == location_id
        )
    )
    if location is None:
        raise NotFoundError("Stock location not found", code="location.not_found")
    principal.require(P.BRANCHES_MANAGE, location.branch_id)
    values = data.model_dump(exclude_unset=True)
    if values.get("is_default") is False and location.is_default:
        raise BusinessRuleError(
            "Choose another default location instead of unsetting this one",
            code="location.default_required",
        )
    if values.get("is_active") is False and location.is_default:
        raise BusinessRuleError(
            "The default location cannot be deactivated", code="location.default_required"
        )
    if values.get("is_default") and not location.is_default:
        await _clear_default(db, location.branch_id)
    changes = apply_patch(location, values, set())
    audit.record(
        db,
        actor,
        "stock_location.updated",
        entity_type="stock_location",
        entity_id=location.id,
        branch_id=location.branch_id,
        changes=changes,
    )
    await db.commit()
    await db.refresh(location)
    return location


async def _clear_default(db: AsyncSession, branch_id: uuid.UUID) -> None:
    await db.execute(
        update(StockLocation)
        .where(StockLocation.branch_id == branch_id, StockLocation.is_default.is_(True))
        .values(is_default=False)
    )
    # Flush so the partial unique index sees the old default cleared before the new one is set.
    await db.flush()


async def _ensure_branch_code_free(db: AsyncSession, company_id: uuid.UUID, code: str) -> None:
    if await db.scalar(
        select(Branch.id).where(Branch.company_id == company_id, Branch.code == code)
    ):
        raise ConflictError("Branch code already in use", code="branch.code_taken")
