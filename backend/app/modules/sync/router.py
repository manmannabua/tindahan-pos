"""Sync endpoints. Authenticated with a *device* token: sync runs even when no cashier is
logged in (e.g. yesterday's sales from a closed shift)."""

import re
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import BigInteger, cast, func, select
from sqlalchemy.orm import selectinload

from app.core.rate_limit import enforce_rate_limit
from app.modules.auth.dependencies import CurrentDevice, DbSession
from app.modules.branches.models import Branch, StockLocation
from app.modules.companies.models import Company
from app.modules.devices.models import Device
from app.modules.realtime.service import mark_device_online
from app.modules.returns.models import ReturnItem
from app.modules.sales.models import Sale
from app.modules.sales.schemas import SaleDetail
from app.modules.sync import pull as pull_service
from app.modules.sync import pull_schemas as ps
from app.modules.sync.push import push
from app.modules.sync.schemas import PullResponse, PushRequest, PushResponse, SyncContext
from app.shared.exceptions import BusinessRuleError, NotFoundError
from app.shared.schemas import ResponseSchema

router = APIRouter(prefix="/sync", tags=["sync"])


@router.post("/push", response_model=PushResponse)
async def push_operations(data: PushRequest, device: CurrentDevice, db: DbSession) -> PushResponse:
    """Apply outbox operations. Always returns 200 with a per-operation status."""
    await enforce_rate_limit(f"sync:push:{device.device_id}", limit=120, window_seconds=60)
    return await push(db, device, data)


@router.get("/pull", response_model=PullResponse)
async def pull_changes(
    device: CurrentDevice,
    db: DbSession,
    cursor: Annotated[str | None, Query(max_length=2000)] = None,
    limit: Annotated[int, Query(ge=1, le=5000)] = 1000,
) -> PullResponse:
    await enforce_rate_limit(f"sync:pull:{device.device_id}", limit=240, window_seconds=60)
    await mark_device_online(device.device_id)
    return await pull_service.pull(db, device, cursor, limit)


@router.get("/context", response_model=SyncContext)
async def sync_context(device: CurrentDevice, db: DbSession) -> SyncContext:
    """Everything a terminal needs to know about itself before the first pull."""
    company = await db.get(Company, device.company_id)
    branch = await db.get(Branch, device.branch_id)
    locations = list(
        await db.scalars(select(StockLocation).where(StockLocation.branch_id == device.branch_id))
    )
    default = next((loc for loc in locations if loc.is_default), None)
    if company is None or branch is None or default is None:
        raise BusinessRuleError("Branch is not configured", code="sync.branch_not_configured")
    prefix = f"{branch.code}-{device.terminal_code}-"
    # Continue numbering where any previous device with this terminal code stopped, so a
    # replaced terminal never reissues a receipt number.
    last = await db.scalar(
        select(func.max(cast(func.substr(Sale.receipt_number, len(prefix) + 1), BigInteger))).where(
            Sale.branch_id == branch.id,
            Sale.receipt_number.regexp_match(f"^{re.escape(prefix)}[0-9]+$"),
        )
    )
    device_row = await db.get(Device, device.device_id)
    assert device_row is not None  # noqa: S101
    return SyncContext(
        device_id=device.device_id,
        terminal_code=device.terminal_code,
        device_bir={
            "min": device_row.bir_min,
            "serial_number": device_row.bir_serial_number,
            "ptu_number": device_row.bir_ptu_number,
            "ptu_issued_on": device_row.bir_ptu_issued_on.isoformat()
            if device_row.bir_ptu_issued_on
            else None,
        },
        company=ps.CompanySync.model_validate(company).model_dump(mode="json"),
        branch=ps.BranchSync.model_validate(branch).model_dump(mode="json"),
        stock_locations=[
            ps.StockLocationSync.model_validate(loc).model_dump(mode="json") for loc in locations
        ],
        default_stock_location_id=default.id,
        receipt_prefix=prefix,
        last_receipt_seq=int(last or 0),
        server_time=datetime.now(UTC),
        features=company.features,
    )


class SaleLookup(ResponseSchema):
    sale: SaleDetail
    # Quantity already returned per sale item (in the unit it was sold in) and amount refunded.
    returned_quantities: dict[uuid.UUID, Decimal]
    refunded_amounts: dict[uuid.UUID, Decimal]


@router.get("/sales/lookup", response_model=SaleLookup)
async def lookup_sale(
    device: CurrentDevice,
    db: DbSession,
    receipt_number: Annotated[str, Query(min_length=1, max_length=40)],
) -> SaleLookup:
    """Online lookup of a sale made on ANY terminal of the company, so a POS can process a
    return for it. Offline, returns are limited to sales stored on the terminal itself."""
    sale = await db.scalar(
        select(Sale)
        .where(Sale.company_id == device.company_id, Sale.receipt_number == receipt_number)
        .options(selectinload(Sale.items), selectinload(Sale.payments))
    )
    if sale is None:
        raise NotFoundError("Sale not found", code="sale.not_found")
    rows = (
        await db.execute(
            select(
                ReturnItem.sale_item_id,
                func.sum(ReturnItem.quantity),
                func.sum(ReturnItem.refund_amount),
            )
            .where(ReturnItem.sale_item_id.in_([i.id for i in sale.items]))
            .group_by(ReturnItem.sale_item_id)
        )
    ).all()
    return SaleLookup(
        sale=SaleDetail.model_validate(sale),
        returned_quantities={item_id: Decimal(qty) for item_id, qty, _ in rows},
        refunded_amounts={item_id: Decimal(amount) for item_id, _, amount in rows},
    )
