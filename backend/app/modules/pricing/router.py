import uuid

from fastapi import APIRouter, Depends, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_permission,
)
from app.modules.pricing import service
from app.modules.pricing.schemas import (
    PriceLevelCreate,
    PriceLevelRead,
    PriceLevelUpdate,
    TaxRateCreate,
    TaxRateRead,
    TaxRateUpdate,
)
from app.modules.users.permissions import P

router = APIRouter(tags=["pricing"])
_read = [Depends(require_permission(P.PRODUCTS_READ))]


@router.get("/tax-rates", response_model=list[TaxRateRead], dependencies=_read)
async def list_tax_rates(principal: CurrentPrincipal, db: DbSession) -> list[TaxRateRead]:
    return [
        TaxRateRead.model_validate(r)
        for r in await service.list_tax_rates(db, principal.company_id)
    ]


@router.post("/tax-rates", response_model=TaxRateRead, status_code=status.HTTP_201_CREATED)
async def create_tax_rate(
    data: TaxRateCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> TaxRateRead:
    row = await service.create_tax_rate(db, principal, data, audit_actor(principal, request))
    return TaxRateRead.model_validate(row)


@router.patch("/tax-rates/{tax_rate_id}", response_model=TaxRateRead)
async def update_tax_rate(
    tax_rate_id: uuid.UUID,
    data: TaxRateUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> TaxRateRead:
    row = await service.update_tax_rate(
        db, principal, tax_rate_id, data, audit_actor(principal, request)
    )
    return TaxRateRead.model_validate(row)


@router.get("/price-levels", response_model=list[PriceLevelRead], dependencies=_read)
async def list_price_levels(principal: CurrentPrincipal, db: DbSession) -> list[PriceLevelRead]:
    rows = await service.list_price_levels(db, principal.company_id)
    return [PriceLevelRead.model_validate(r) for r in rows]


@router.post("/price-levels", response_model=PriceLevelRead, status_code=status.HTTP_201_CREATED)
async def create_price_level(
    data: PriceLevelCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> PriceLevelRead:
    row = await service.create_price_level(db, principal, data, audit_actor(principal, request))
    return PriceLevelRead.model_validate(row)


@router.patch("/price-levels/{level_id}", response_model=PriceLevelRead)
async def update_price_level(
    level_id: uuid.UUID,
    data: PriceLevelUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> PriceLevelRead:
    row = await service.update_price_level(
        db, principal, level_id, data, audit_actor(principal, request)
    )
    return PriceLevelRead.model_validate(row)
