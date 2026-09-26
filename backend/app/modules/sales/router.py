import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.modules.auth.dependencies import CurrentPrincipal, DbSession, require_permission
from app.modules.sales import service
from app.modules.sales.schemas import SaleDetail, SaleSummary
from app.modules.users.permissions import P
from app.shared.schemas import Page

router = APIRouter(prefix="/sales", tags=["sales"])
_view = [Depends(require_permission(P.SALES_VIEW))]


@router.get("", response_model=Page[SaleSummary], dependencies=_view)
async def list_sales(
    principal: CurrentPrincipal,
    db: DbSession,
    branch_id: uuid.UUID | None = None,
    device_id: uuid.UUID | None = None,
    cashier_id: uuid.UUID | None = None,
    cash_session_id: uuid.UUID | None = None,
    receipt_number: Annotated[str | None, Query(max_length=40)] = None,
    occurred_from: datetime | None = None,
    occurred_to: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[SaleSummary]:
    rows, total = await service.list_sales(
        db,
        principal,
        branch_id=branch_id,
        device_id=device_id,
        cashier_id=cashier_id,
        cash_session_id=cash_session_id,
        receipt_number=receipt_number,
        occurred_from=occurred_from,
        occurred_to=occurred_to,
        limit=limit,
        offset=offset,
    )
    return Page(
        items=[SaleSummary.model_validate(r) for r in rows], total=total, limit=limit, offset=offset
    )


@router.get("/{sale_id}", response_model=SaleDetail, dependencies=_view)
async def get_sale(sale_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession) -> SaleDetail:
    return SaleDetail.model_validate(await service.get_sale(db, principal, sale_id))
