import uuid

from fastapi import APIRouter, Depends, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_permission,
)
from app.modules.branches import service
from app.modules.branches.schemas import (
    BranchCreate,
    BranchDetail,
    BranchRead,
    BranchUpdate,
    StockLocationCreate,
    StockLocationRead,
    StockLocationUpdate,
)
from app.modules.users.permissions import P

router = APIRouter(prefix="/branches", tags=["branches"])


@router.get("", response_model=list[BranchRead])
async def list_branches(
    principal: CurrentPrincipal, db: DbSession, include_inactive: bool = False
) -> list[BranchRead]:
    """All branches of the company (any authenticated user may see branch names)."""
    branches = await service.list_branches(db, principal, include_inactive=include_inactive)
    return [BranchRead.model_validate(b) for b in branches]


@router.post(
    "",
    response_model=BranchDetail,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_permission(P.BRANCHES_MANAGE))],
)
async def create_branch(
    data: BranchCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> BranchDetail:
    branch = await service.create_branch(db, principal, data, audit_actor(principal, request))
    return BranchDetail.model_validate(branch)


@router.get("/{branch_id}", response_model=BranchDetail)
async def get_branch(
    branch_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> BranchDetail:
    branch = await service.get_branch(db, principal.company_id, branch_id, with_locations=True)
    return BranchDetail.model_validate(branch)


@router.patch("/{branch_id}", response_model=BranchDetail)
async def update_branch(
    branch_id: uuid.UUID,
    data: BranchUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> BranchDetail:
    branch = await service.update_branch(
        db, principal, branch_id, data, audit_actor(principal, request)
    )
    return BranchDetail.model_validate(branch)


@router.post(
    "/{branch_id}/locations",
    response_model=StockLocationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_location(
    branch_id: uuid.UUID,
    data: StockLocationCreate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> StockLocationRead:
    location = await service.create_location(
        db, principal, branch_id, data, audit_actor(principal, request)
    )
    return StockLocationRead.model_validate(location)


locations_router = APIRouter(prefix="/stock-locations", tags=["branches"])


@locations_router.patch("/{location_id}", response_model=StockLocationRead)
async def update_location(
    location_id: uuid.UUID,
    data: StockLocationUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> StockLocationRead:
    location = await service.update_location(
        db, principal, location_id, data, audit_actor(principal, request)
    )
    return StockLocationRead.model_validate(location)
