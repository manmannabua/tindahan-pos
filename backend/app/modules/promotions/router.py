import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_feature,
    require_permission,
)
from app.modules.companies.features import Feature
from app.modules.promotions import service
from app.modules.promotions.models import Promotion
from app.modules.promotions.schemas import PromotionCreate, PromotionRead, PromotionUpdate
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.schemas import Page

router = APIRouter(
    prefix="/promotions",
    tags=["promotions"],
    dependencies=[Depends(require_feature(Feature.PROMOTIONS))],
)
_read = [Depends(require_permission(P.PRODUCTS_READ))]


@router.get("", response_model=Page[PromotionRead], dependencies=_read)
async def list_promotions(
    principal: CurrentPrincipal,
    db: DbSession,
    include_inactive: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[PromotionRead]:
    rows, total = await service.list_promotions(
        db, principal.company_id, include_inactive=include_inactive, limit=limit, offset=offset
    )
    return Page(
        items=[PromotionRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=PromotionRead, status_code=status.HTTP_201_CREATED)
async def create_promotion(
    data: PromotionCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> PromotionRead:
    row = await service.create_promotion(db, principal, data, audit_actor(principal, request))
    return PromotionRead.model_validate(row)


@router.get("/{promotion_id}", response_model=PromotionRead, dependencies=_read)
async def get_promotion(
    promotion_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> PromotionRead:
    row = await crud.get_scoped(db, Promotion, principal.company_id, promotion_id, "promotion")
    return PromotionRead.model_validate(row)


@router.put("/{promotion_id}", response_model=PromotionRead)
async def update_promotion(
    promotion_id: uuid.UUID,
    data: PromotionUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> PromotionRead:
    row = await service.update_promotion(
        db, principal, promotion_id, data, audit_actor(principal, request)
    )
    return PromotionRead.model_validate(row)
