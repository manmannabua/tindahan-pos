import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_any_permission,
)
from app.modules.purchasing import service
from app.modules.purchasing.models import POStatus
from app.modules.purchasing.schemas import (
    POCreate,
    PORead,
    POUpdate,
    ReceiptCreate,
    ReceiptRead,
)
from app.modules.users.permissions import P
from app.shared.schemas import Page

router = APIRouter(tags=["purchasing"])
_view = [Depends(require_any_permission(P.PURCHASING_MANAGE, P.PURCHASING_RECEIVE))]


@router.get("/purchase-orders", response_model=Page[PORead], dependencies=_view)
async def list_purchase_orders(
    principal: CurrentPrincipal,
    db: DbSession,
    status: POStatus | None = None,
    supplier_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[PORead]:
    rows, total = await service.list_pos(
        db, principal, status=status, supplier_id=supplier_id, limit=limit, offset=offset
    )
    return Page(
        items=[PORead.model_validate(r) for r in rows], total=total, limit=limit, offset=offset
    )


@router.post("/purchase-orders", response_model=PORead, status_code=status.HTTP_201_CREATED)
async def create_purchase_order(
    data: POCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> PORead:
    return PORead.model_validate(
        await service.create_po(db, principal, data, audit_actor(principal, request))
    )


@router.get("/purchase-orders/{po_id}", response_model=PORead, dependencies=_view)
async def get_purchase_order(
    po_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> PORead:
    return PORead.model_validate(await service.get_po(db, principal, po_id))


@router.patch("/purchase-orders/{po_id}", response_model=PORead)
async def update_purchase_order(
    po_id: uuid.UUID, data: POUpdate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> PORead:
    return PORead.model_validate(
        await service.update_po(db, principal, po_id, data, audit_actor(principal, request))
    )


@router.post("/purchase-orders/{po_id}/approve", response_model=PORead)
async def approve_purchase_order(
    po_id: uuid.UUID, principal: CurrentPrincipal, request: Request, db: DbSession
) -> PORead:
    return PORead.model_validate(
        await service.approve_po(db, principal, po_id, audit_actor(principal, request))
    )


@router.post("/purchase-orders/{po_id}/cancel", response_model=PORead)
async def cancel_purchase_order(
    po_id: uuid.UUID, principal: CurrentPrincipal, request: Request, db: DbSession
) -> PORead:
    return PORead.model_validate(
        await service.cancel_po(db, principal, po_id, audit_actor(principal, request))
    )


@router.post("/purchase-orders/{po_id}/close", response_model=PORead)
async def close_purchase_order(
    po_id: uuid.UUID, principal: CurrentPrincipal, request: Request, db: DbSession
) -> PORead:
    return PORead.model_validate(
        await service.close_po(db, principal, po_id, audit_actor(principal, request))
    )


@router.get("/goods-receipts", response_model=Page[ReceiptRead], dependencies=_view)
async def list_goods_receipts(
    principal: CurrentPrincipal,
    db: DbSession,
    supplier_id: uuid.UUID | None = None,
    purchase_order_id: uuid.UUID | None = None,
    received_from: date | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ReceiptRead]:
    rows, total = await service.list_receipts(
        db,
        principal,
        supplier_id=supplier_id,
        purchase_order_id=purchase_order_id,
        received_from=received_from,
        limit=limit,
        offset=offset,
    )
    return Page(
        items=[ReceiptRead.model_validate(r) for r in rows], total=total, limit=limit, offset=offset
    )


@router.post("/goods-receipts", response_model=ReceiptRead, status_code=status.HTTP_201_CREATED)
async def receive_goods(
    data: ReceiptCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> ReceiptRead:
    """Post received goods: PURCHASE movements, moving-average cost, PO progress."""
    return ReceiptRead.model_validate(
        await service.receive_goods(db, principal, data, audit_actor(principal, request))
    )


@router.get("/goods-receipts/{receipt_id}", response_model=ReceiptRead, dependencies=_view)
async def get_goods_receipt(
    receipt_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> ReceiptRead:
    return ReceiptRead.model_validate(await service.get_receipt(db, principal, receipt_id))
