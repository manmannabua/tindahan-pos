import uuid
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_feature,
    require_permission,
)
from app.modules.companies.features import Feature
from app.modules.inventory import operations as ops
from app.modules.inventory.models import StockCount, StockTransfer
from app.modules.inventory.operations_schemas import (
    AdjustmentCreate,
    AdjustmentRead,
    CountCreate,
    CountLineIn,
    CountLineRead,
    CountRead,
    ItemRefIn,
    TransferCreate,
    TransferRead,
    TransferReceive,
)
from app.modules.users.permissions import P
from app.shared.schemas import Page

router = APIRouter(
    prefix="/inventory",
    tags=["inventory operations"],
    dependencies=[Depends(require_feature(Feature.INVENTORY))],
)
_read = [Depends(require_permission(P.INVENTORY_READ))]


def _ref(line: ItemRefIn, quantity: Decimal) -> ops.LineRef:
    return ops.LineRef(
        quantity=quantity,
        variant_id=line.variant_id,
        barcode=line.barcode,
        unit_id=line.unit_id,
    )


# --- adjustments -------------------------------------------------------------------------


@router.post("/adjustments", response_model=AdjustmentRead, status_code=status.HTTP_201_CREATED)
async def create_adjustment(
    data: AdjustmentCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> AdjustmentRead:
    adjustment = await ops.create_adjustment(
        db,
        principal,
        stock_location_id=data.stock_location_id,
        reason=data.reason,
        note=data.note,
        lines=[ops.AdjustmentLineIn(_ref(line, line.quantity), line.reason) for line in data.lines],
        actor=audit_actor(principal, request),
    )
    return AdjustmentRead.model_validate(adjustment)


@router.get("/adjustments", response_model=Page[AdjustmentRead], dependencies=_read)
async def list_adjustments(
    principal: CurrentPrincipal,
    db: DbSession,
    branch_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[AdjustmentRead]:
    rows, total = await ops.list_adjustments(
        db, principal, branch_id=branch_id, limit=limit, offset=offset
    )
    return Page(
        items=[AdjustmentRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


# --- counts --------------------------------------------------------------------------------


@router.post("/counts", response_model=CountRead, status_code=status.HTTP_201_CREATED)
async def start_count(
    data: CountCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> CountRead:
    count = await ops.start_count(
        db,
        principal,
        stock_location_id=data.stock_location_id,
        is_full=data.is_full,
        note=data.note,
        actor=audit_actor(principal, request),
    )
    return CountRead.model_validate(count)


@router.get("/counts", response_model=Page[CountRead], dependencies=_read)
async def list_counts(
    principal: CurrentPrincipal,
    db: DbSession,
    status: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[CountRead]:
    rows, total = await ops.list_documents(
        db, principal, StockCount, status=status, limit=limit, offset=offset
    )
    return Page(
        items=[CountRead.model_validate(r) for r in rows], total=total, limit=limit, offset=offset
    )


@router.get("/counts/{count_id}", response_model=CountRead, dependencies=_read)
async def get_count(count_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession) -> CountRead:
    return CountRead.model_validate(await ops.get_count(db, principal, count_id))


@router.post("/counts/{count_id}/lines", response_model=CountLineRead)
async def record_count(
    count_id: uuid.UUID, data: CountLineIn, principal: CurrentPrincipal, db: DbSession
) -> CountLineRead:
    """Record a count line — typically one call per barcode scan (mode ADD, quantity 1)."""
    line = await ops.record_count(
        db, principal, count_id, _ref(data, data.quantity), mode=data.mode
    )
    return CountLineRead.model_validate(line)


@router.post("/counts/{count_id}/complete", response_model=CountRead)
async def complete_count(
    count_id: uuid.UUID, principal: CurrentPrincipal, request: Request, db: DbSession
) -> CountRead:
    count = await ops.complete_count(db, principal, count_id, audit_actor(principal, request))
    return CountRead.model_validate(count)


@router.post("/counts/{count_id}/cancel", response_model=CountRead)
async def cancel_count(
    count_id: uuid.UUID, principal: CurrentPrincipal, request: Request, db: DbSession
) -> CountRead:
    count = await ops.cancel_count(db, principal, count_id, audit_actor(principal, request))
    return CountRead.model_validate(count)


# --- transfers -----------------------------------------------------------------------------


@router.post("/transfers", response_model=TransferRead, status_code=status.HTTP_201_CREATED)
async def create_transfer(
    data: TransferCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> TransferRead:
    transfer = await ops.create_transfer(
        db,
        principal,
        from_location_id=data.from_location_id,
        to_location_id=data.to_location_id,
        note=data.note,
        lines=[_ref(line, line.quantity) for line in data.lines],
        actor=audit_actor(principal, request),
    )
    return TransferRead.model_validate(transfer)


@router.get("/transfers", response_model=Page[TransferRead], dependencies=_read)
async def list_transfers(
    principal: CurrentPrincipal,
    db: DbSession,
    status: str | None = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[TransferRead]:
    rows, total = await ops.list_documents(
        db, principal, StockTransfer, status=status, limit=limit, offset=offset
    )
    return Page(
        items=[TransferRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/transfers/{transfer_id}", response_model=TransferRead, dependencies=_read)
async def get_transfer(
    transfer_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> TransferRead:
    return TransferRead.model_validate(await ops.get_transfer(db, principal, transfer_id))


@router.post("/transfers/{transfer_id}/send", response_model=TransferRead)
async def send_transfer(
    transfer_id: uuid.UUID, principal: CurrentPrincipal, request: Request, db: DbSession
) -> TransferRead:
    transfer = await ops.send_transfer(db, principal, transfer_id, audit_actor(principal, request))
    return TransferRead.model_validate(transfer)


@router.post("/transfers/{transfer_id}/receive", response_model=TransferRead)
async def receive_transfer(
    transfer_id: uuid.UUID,
    data: TransferReceive,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> TransferRead:
    received = {line.line_id: line.received_base_quantity for line in data.lines}
    transfer = await ops.receive_transfer(
        db, principal, transfer_id, received, audit_actor(principal, request)
    )
    return TransferRead.model_validate(transfer)


@router.post("/transfers/{transfer_id}/cancel", response_model=TransferRead)
async def cancel_transfer(
    transfer_id: uuid.UUID, principal: CurrentPrincipal, request: Request, db: DbSession
) -> TransferRead:
    transfer = await ops.cancel_transfer(
        db, principal, transfer_id, audit_actor(principal, request)
    )
    return TransferRead.model_validate(transfer)
