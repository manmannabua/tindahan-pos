import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_any_permission,
    require_feature,
)
from app.modules.companies.features import Feature
from app.modules.suppliers import service
from app.modules.suppliers.models import Supplier
from app.modules.suppliers.schemas import SupplierCreate, SupplierRead, SupplierUpdate
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.schemas import Page

router = APIRouter(
    prefix="/suppliers",
    tags=["purchasing"],
    dependencies=[Depends(require_feature(Feature.PURCHASING))],
)
# Anyone who manages suppliers, buys or receives stock needs to see suppliers.
_view = [
    Depends(require_any_permission(P.SUPPLIERS_MANAGE, P.PURCHASING_MANAGE, P.PURCHASING_RECEIVE))
]


@router.get("", response_model=Page[SupplierRead], dependencies=_view)
async def list_suppliers(
    principal: CurrentPrincipal,
    db: DbSession,
    q: Annotated[str | None, Query(max_length=100)] = None,
    include_inactive: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[SupplierRead]:
    rows, total = await service.list_suppliers(
        db,
        principal.company_id,
        q=q,
        include_inactive=include_inactive,
        limit=limit,
        offset=offset,
    )
    return Page(
        items=[SupplierRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=SupplierRead, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    data: SupplierCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> SupplierRead:
    row = await service.create_supplier(db, principal, data, audit_actor(principal, request))
    return SupplierRead.model_validate(row)


@router.get("/{supplier_id}", response_model=SupplierRead, dependencies=_view)
async def get_supplier(
    supplier_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> SupplierRead:
    row = await crud.get_scoped(db, Supplier, principal.company_id, supplier_id, "supplier")
    return SupplierRead.model_validate(row)


@router.patch("/{supplier_id}", response_model=SupplierRead)
async def update_supplier(
    supplier_id: uuid.UUID,
    data: SupplierUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> SupplierRead:
    row = await service.update_supplier(
        db, principal, supplier_id, data, audit_actor(principal, request)
    )
    return SupplierRead.model_validate(row)
