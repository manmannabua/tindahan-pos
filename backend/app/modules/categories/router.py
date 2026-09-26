import uuid

from fastapi import APIRouter, Depends, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_permission,
)
from app.modules.categories import service
from app.modules.categories.schemas import CategoryCreate, CategoryRead, CategoryUpdate
from app.modules.users.permissions import P

router = APIRouter(prefix="/categories", tags=["catalog"])


@router.get(
    "",
    response_model=list[CategoryRead],
    dependencies=[Depends(require_permission(P.PRODUCTS_READ))],
)
async def list_categories(
    principal: CurrentPrincipal, db: DbSession, include_inactive: bool = False
) -> list[CategoryRead]:
    rows = await service.list_categories(
        db, principal.company_id, include_inactive=include_inactive
    )
    return [CategoryRead.model_validate(r) for r in rows]


@router.post("", response_model=CategoryRead, status_code=status.HTTP_201_CREATED)
async def create_category(
    data: CategoryCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> CategoryRead:
    row = await service.create_category(db, principal, data, audit_actor(principal, request))
    return CategoryRead.model_validate(row)


@router.patch("/{category_id}", response_model=CategoryRead)
async def update_category(
    category_id: uuid.UUID,
    data: CategoryUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> CategoryRead:
    row = await service.update_category(
        db, principal, category_id, data, audit_actor(principal, request)
    )
    return CategoryRead.model_validate(row)
