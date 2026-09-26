import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_permission,
)
from app.modules.customers import service
from app.modules.customers.models import Customer
from app.modules.customers.schemas import CustomerCreate, CustomerRead, CustomerUpdate
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.schemas import Page

router = APIRouter(prefix="/customers", tags=["customers"])
_read = [Depends(require_permission(P.CUSTOMERS_READ))]


@router.get("", response_model=Page[CustomerRead], dependencies=_read)
async def list_customers(
    principal: CurrentPrincipal,
    db: DbSession,
    q: Annotated[
        str | None, Query(max_length=100, description="Name, code, email or phone")
    ] = None,
    include_inactive: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[CustomerRead]:
    rows, total = await service.list_customers(
        db, principal.company_id, q=q, include_inactive=include_inactive, limit=limit, offset=offset
    )
    return Page(
        items=[CustomerRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("", response_model=CustomerRead, status_code=status.HTTP_201_CREATED)
async def create_customer(
    data: CustomerCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> CustomerRead:
    row = await service.create_customer(db, principal, data, audit_actor(principal, request))
    return CustomerRead.model_validate(row)


@router.get("/{customer_id}", response_model=CustomerRead, dependencies=_read)
async def get_customer(
    customer_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> CustomerRead:
    row = await crud.get_scoped(db, Customer, principal.company_id, customer_id, "customer")
    return CustomerRead.model_validate(row)


@router.patch("/{customer_id}", response_model=CustomerRead)
async def update_customer(
    customer_id: uuid.UUID,
    data: CustomerUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> CustomerRead:
    row = await service.update_customer(
        db, principal, customer_id, data, audit_actor(principal, request)
    )
    return CustomerRead.model_validate(row)
