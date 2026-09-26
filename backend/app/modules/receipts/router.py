import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.modules.auth.dependencies import CurrentPrincipal, DbSession, require_permission
from app.modules.receipts import service
from app.modules.receipts.models import ReceiptKind
from app.modules.receipts.schemas import SalesReceiptRead, SalesReceiptSummary
from app.modules.users.permissions import P
from app.shared.schemas import Page

router = APIRouter(prefix="/receipts", tags=["receipts"])
_view = [Depends(require_permission(P.SALES_VIEW))]


@router.get("", response_model=Page[SalesReceiptSummary], dependencies=_view)
async def list_receipts(
    principal: CurrentPrincipal,
    db: DbSession,
    q: Annotated[str | None, Query(max_length=40, description="Receipt/return number")] = None,
    kind: ReceiptKind | None = None,
    printed: Annotated[bool | None, Query(description="false = never printed")] = None,
    branch_id: uuid.UUID | None = None,
    device_id: uuid.UUID | None = None,
    sale_id: uuid.UUID | None = None,
    issued_from: datetime | None = None,
    issued_to: datetime | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[SalesReceiptSummary]:
    """The receipt journal: every receipt issued by the terminals, printed or not."""
    items, total = await service.list_receipts(
        db,
        principal,
        q=q,
        kind=kind,
        printed=printed,
        branch_id=branch_id,
        device_id=device_id,
        sale_id=sale_id,
        issued_from=issued_from,
        issued_to=issued_to,
        limit=limit,
        offset=offset,
    )
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/{receipt_id}", response_model=SalesReceiptRead, dependencies=_view)
async def get_receipt(
    receipt_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> SalesReceiptRead:
    return await service.get_receipt(db, principal, receipt_id)
