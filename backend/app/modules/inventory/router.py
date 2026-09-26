import uuid
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_permission,
)
from app.modules.inventory import service
from app.modules.inventory.models import MovementType
from app.modules.inventory.schemas import (
    BalanceRead,
    InitialStockRequest,
    MovementRead,
    PostingResultRead,
)
from app.modules.users.permissions import P
from app.shared.schemas import Page

router = APIRouter(prefix="/inventory", tags=["inventory"])
_read = [Depends(require_permission(P.INVENTORY_READ))]


@router.get("/balances", response_model=Page[BalanceRead], dependencies=_read)
async def list_balances(
    principal: CurrentPrincipal,
    db: DbSession,
    branch_id: uuid.UUID | None = None,
    stock_location_id: uuid.UUID | None = None,
    q: Annotated[str | None, Query(max_length=100)] = None,
    low_stock: bool = False,
    negative: bool = False,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[BalanceRead]:
    rows, total = await service.list_balances(
        db,
        principal,
        branch_id=branch_id,
        stock_location_id=stock_location_id,
        q=q,
        only_low=low_stock,
        only_negative=negative,
        limit=limit,
        offset=offset,
    )
    return Page(
        items=[BalanceRead(**asdict(r)) for r in rows], total=total, limit=limit, offset=offset
    )


@router.get("/movements", response_model=Page[MovementRead], dependencies=_read)
async def list_movements(
    principal: CurrentPrincipal,
    db: DbSession,
    variant_id: uuid.UUID | None = None,
    stock_location_id: uuid.UUID | None = None,
    movement_type: MovementType | None = None,
    reference_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[MovementRead]:
    rows, total = await service.list_movements(
        db,
        principal,
        variant_id=variant_id,
        stock_location_id=stock_location_id,
        movement_type=movement_type,
        reference_id=reference_id,
        limit=limit,
        offset=offset,
    )
    return Page(
        items=[MovementRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/initial-stock", response_model=PostingResultRead, status_code=status.HTTP_201_CREATED
)
async def post_initial_stock(
    data: InitialStockRequest, principal: CurrentPrincipal, request: Request, db: DbSession
) -> PostingResultRead:
    result = await service.post_initial_stock(
        db,
        principal,
        data.stock_location_id,
        [service.StockLine(line.variant_id, line.quantity, line.unit_cost) for line in data.lines],
        data.note,
        audit_actor(principal, request),
    )
    return PostingResultRead(
        posted=len(result.movements),
        skipped_untracked=result.skipped_untracked,
        negative_balances=len(result.negative),
    )
