import uuid

from fastapi import APIRouter, Request, status

from app.modules.auth.dependencies import CurrentPrincipal, DbSession, audit_actor
from app.modules.payments import service
from app.modules.payments.schemas import (
    PaymentMethodCreate,
    PaymentMethodRead,
    PaymentMethodUpdate,
)

router = APIRouter(prefix="/payment-methods", tags=["payments"])


@router.get("", response_model=list[PaymentMethodRead])
async def list_methods(principal: CurrentPrincipal, db: DbSession) -> list[PaymentMethodRead]:
    rows = await service.list_methods(db, principal.company_id)
    return [PaymentMethodRead.model_validate(r) for r in rows]


@router.post("", response_model=PaymentMethodRead, status_code=status.HTTP_201_CREATED)
async def create_method(
    data: PaymentMethodCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> PaymentMethodRead:
    row = await service.create_method(db, principal, data, audit_actor(principal, request))
    return PaymentMethodRead.model_validate(row)


@router.patch("/{method_id}", response_model=PaymentMethodRead)
async def update_method(
    method_id: uuid.UUID,
    data: PaymentMethodUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> PaymentMethodRead:
    row = await service.update_method(
        db, principal, method_id, data, audit_actor(principal, request)
    )
    return PaymentMethodRead.model_validate(row)
