import uuid

from fastapi import APIRouter, Depends, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_permission,
)
from app.modules.units import service
from app.modules.units.schemas import UnitCreate, UnitRead, UnitUpdate
from app.modules.users.permissions import P

router = APIRouter(prefix="/units", tags=["catalog"])


@router.get(
    "", response_model=list[UnitRead], dependencies=[Depends(require_permission(P.PRODUCTS_READ))]
)
async def list_units(
    principal: CurrentPrincipal, db: DbSession, include_inactive: bool = False
) -> list[UnitRead]:
    rows = await service.list_units(db, principal.company_id, include_inactive=include_inactive)
    return [UnitRead.model_validate(r) for r in rows]


@router.post("", response_model=UnitRead, status_code=status.HTTP_201_CREATED)
async def create_unit(
    data: UnitCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> UnitRead:
    row = await service.create_unit(db, principal, data, audit_actor(principal, request))
    return UnitRead.model_validate(row)


@router.patch("/{unit_id}", response_model=UnitRead)
async def update_unit(
    unit_id: uuid.UUID,
    data: UnitUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> UnitRead:
    row = await service.update_unit(db, principal, unit_id, data, audit_actor(principal, request))
    return UnitRead.model_validate(row)
