import uuid

from fastapi import APIRouter, Depends, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_permission,
)
from app.modules.brands import service
from app.modules.brands.schemas import BrandCreate, BrandRead, BrandUpdate
from app.modules.users.permissions import P

router = APIRouter(prefix="/brands", tags=["catalog"])


@router.get(
    "", response_model=list[BrandRead], dependencies=[Depends(require_permission(P.PRODUCTS_READ))]
)
async def list_brands(
    principal: CurrentPrincipal, db: DbSession, include_inactive: bool = False
) -> list[BrandRead]:
    rows = await service.list_brands(db, principal.company_id, include_inactive=include_inactive)
    return [BrandRead.model_validate(r) for r in rows]


@router.post("", response_model=BrandRead, status_code=status.HTTP_201_CREATED)
async def create_brand(
    data: BrandCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> BrandRead:
    row = await service.create_brand(db, principal, data, audit_actor(principal, request))
    return BrandRead.model_validate(row)


@router.patch("/{brand_id}", response_model=BrandRead)
async def update_brand(
    brand_id: uuid.UUID,
    data: BrandUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> BrandRead:
    row = await service.update_brand(db, principal, brand_id, data, audit_actor(principal, request))
    return BrandRead.model_validate(row)
