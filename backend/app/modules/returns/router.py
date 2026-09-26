"""Online voids and returns (admin portal / POS while online). Offline terminals use the sync
operations `sale.void` and `return.create`, which call the same service functions."""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Request, status
from uuid_utils.compat import uuid7

from app.modules.audit import service as audit
from app.modules.auth.dependencies import CurrentPrincipal, DbSession, audit_actor
from app.modules.returns import service
from app.modules.returns.schemas import ReturnCreate, ReturnRead, VoidRequest
from app.modules.sales.models import Sale
from app.modules.sales.schemas import SaleDetail
from app.modules.sales.service import get_sale
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.sequences import next_number

router = APIRouter(tags=["returns"])


@router.post("/sales/{sale_id}/void", response_model=SaleDetail)
async def void_sale(
    sale_id: uuid.UUID,
    data: VoidRequest,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> SaleDetail:
    sale = await crud.get_scoped(db, Sale, principal.company_id, sale_id, "sale")
    principal.require(P.SALES_VOID, sale.branch_id)
    await service.void_sale(
        db,
        company_id=principal.company_id,
        sale_id=sale_id,
        voided_by_id=principal.user_id,
        authorized_by_id=principal.user_id,
        reason=data.reason,
        occurred_at=datetime.now(UTC),
        device_id=principal.device_id,
    )
    audit.record(
        db,
        audit_actor(principal, request),
        "sale.voided",
        entity_type="sale",
        entity_id=sale_id,
        branch_id=sale.branch_id,
        metadata={"reason": data.reason, "receipt_number": sale.receipt_number},
    )
    await db.commit()
    return SaleDetail.model_validate(await get_sale(db, principal, sale_id))


@router.post("/returns", response_model=ReturnRead, status_code=status.HTTP_201_CREATED)
async def create_return(
    data: ReturnCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> ReturnRead:
    sale = await crud.get_scoped(db, Sale, principal.company_id, data.sale_id, "sale")
    principal.require(P.RETURNS_CREATE, sale.branch_id)
    number = f"RET-{await next_number(db, principal.company_id, 'return'):06d}"
    sale_return = await service.create_return(
        db,
        principal.company_id,
        service.ReturnInput(
            id=data.id or uuid7(),
            sale_id=data.sale_id,
            return_number=number,
            cashier_id=principal.user_id,
            authorized_by_id=data.authorized_by_id or principal.user_id,
            reason=data.reason,
            occurred_at=datetime.now(UTC),
            items=[
                service.ReturnItemInput(i.id or uuid7(), i.sale_item_id, i.quantity, i.restock)
                for i in data.items
            ],
            refunds=[
                service.RefundInput(r.id or uuid7(), r.payment_method_id, r.amount, r.reference_no)
                for r in data.refunds
            ],
            device_id=principal.device_id,
        ),
    )
    audit.record(
        db,
        audit_actor(principal, request),
        "sale.returned",
        entity_type="return",
        entity_id=sale_return.id,
        branch_id=sale.branch_id,
        metadata={"sale_id": str(sale.id), "refund_total": str(sale_return.refund_total)},
    )
    await db.commit()
    return ReturnRead.model_validate(
        await service.get_return(db, principal.company_id, sale_return.id)
    )


@router.get("/returns/{return_id}", response_model=ReturnRead)
async def get_return(
    return_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> ReturnRead:
    sale_return = await service.get_return(db, principal.company_id, return_id)
    principal.require(P.SALES_VIEW, sale_return.branch_id)
    return ReturnRead.model_validate(sale_return)
