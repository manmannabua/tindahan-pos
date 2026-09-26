"""Management dashboard and sync monitoring (Phase 8)."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from app.modules.auth.dependencies import CurrentPrincipal, DbSession, require_permission
from app.modules.companies.models import Company
from app.modules.devices.models import Device, DeviceStatus
from app.modules.realtime.service import online_devices
from app.modules.reporting import service as rs
from app.modules.reporting.period import make_period
from app.modules.reporting.registry import COST_FIELDS, redact, to_jsonable
from app.modules.reporting.service import Scope
from app.modules.review_flags.models import FlagStatus, ReviewFlag
from app.modules.sync.models import OperationStatus, SyncOperation
from app.modules.users.permissions import P
from app.shared.schemas import ResponseSchema

router = APIRouter(tags=["dashboard"])
STALE_AFTER = timedelta(hours=1)


class DashboardResponse(ResponseSchema):
    date: str
    timezone: str
    today: dict[str, Any]
    yesterday: dict[str, Any]
    last_7_days: list[dict[str, Any]]
    top_products_today: list[dict[str, Any]]
    stock: dict[str, int]
    open_flags: dict[str, int]
    devices: dict[str, int]


@router.get(
    "/dashboard",
    response_model=DashboardResponse,
    dependencies=[Depends(require_permission(P.REPORTS_VIEW))],
)
async def dashboard(
    principal: CurrentPrincipal, db: DbSession, branch_id: uuid.UUID | None = None
) -> DashboardResponse:
    company = await db.get(Company, principal.company_id)
    assert company is not None  # noqa: S101
    branch_scope = principal.branch_scope(P.REPORTS_VIEW)
    if branch_id and branch_scope is not None:
        principal.require(P.REPORTS_VIEW, branch_id)
    financial = principal.has_in_any_scope(P.REPORTS_FINANCIAL)
    today = make_period(None, None, company.timezone)
    yesterday = make_period(
        today.date_from - timedelta(days=1), today.date_from - timedelta(days=1), company.timezone
    )
    week = make_period(today.date_from - timedelta(days=6), today.date_to, company.timezone)

    def scope(period: Any) -> Scope:
        return Scope(principal.company_id, period, branch_scope, branch_id)

    hidden = frozenset() if financial else COST_FIELDS
    today_summary = redact(await rs.sales_summary(db, scope(today)), hidden)
    yesterday_summary = redact(await rs.sales_summary(db, scope(yesterday)), hidden)
    top = redact(await rs.sales_by_product(db, scope(today), limit=5), hidden)
    trend = await rs.sales_trend(db, scope(week), "day")

    stock = {
        "low": len(await rs.stock_levels(db, scope(today), condition="low")),
        "out": len(await rs.stock_levels(db, scope(today), condition="out")),
        "negative": len(await rs.stock_levels(db, scope(today), condition="negative")),
    }
    flag_stmt = (
        select(ReviewFlag.flag_type, func.count())
        .where(ReviewFlag.company_id == principal.company_id, ReviewFlag.status == FlagStatus.OPEN)
        .group_by(ReviewFlag.flag_type)
    )
    if branch_scope is not None:
        flag_stmt = flag_stmt.where(ReviewFlag.branch_id.in_(branch_scope))
    flags = {str(t): int(n) for t, n in (await db.execute(flag_stmt)).all()}

    devices = list(
        await db.scalars(
            select(Device).where(
                Device.company_id == principal.company_id, Device.status == DeviceStatus.ACTIVE
            )
        )
    )
    if branch_scope is not None:
        devices = [d for d in devices if d.branch_id in branch_scope]
    online = await online_devices([d.id for d in devices])
    now = datetime.now(UTC)
    device_stats = {
        "active": len(devices),
        "online": len(online),
        "stale": sum(
            1 for d in devices if not d.last_sync_at or now - d.last_sync_at > STALE_AFTER
        ),
        "pending_operations": sum(d.pending_operations or 0 for d in devices),
    }
    return DashboardResponse(
        date=today.date_from.isoformat(),
        timezone=company.timezone,
        today=to_jsonable(today_summary),
        yesterday=to_jsonable(yesterday_summary),
        last_7_days=to_jsonable(trend),
        top_products_today=to_jsonable(top),
        stock=stock,
        open_flags=flags,
        devices=device_stats,
    )


class MonitoredDevice(ResponseSchema):
    id: uuid.UUID
    branch_id: uuid.UUID
    terminal_code: str
    name: str
    app_version: str | None
    online: bool
    last_seen_at: datetime | None
    last_sync_at: datetime | None
    pending_operations: int | None
    stale: bool


class FailedOperation(ResponseSchema):
    id: uuid.UUID
    device_id: uuid.UUID
    entity_type: str
    entity_id: uuid.UUID
    operation: str
    status: str
    error: dict[str, Any] | None
    received_at: datetime


class SyncMonitorResponse(ResponseSchema):
    devices: list[MonitoredDevice]
    failed_operations: list[FailedOperation]


@router.get(
    "/sync/monitor",
    response_model=SyncMonitorResponse,
    dependencies=[Depends(require_permission(P.SYNC_MONITOR))],
)
async def sync_monitor(principal: CurrentPrincipal, db: DbSession) -> SyncMonitorResponse:
    """Terminal health and operations that need attention (REJECTED / CONFLICT, last 30 days)."""
    scope = principal.branch_scope(P.SYNC_MONITOR)
    stmt = select(Device).where(
        Device.company_id == principal.company_id, Device.status == DeviceStatus.ACTIVE
    )
    if scope is not None:
        stmt = stmt.where(Device.branch_id.in_(scope))
    devices = list(await db.scalars(stmt.order_by(Device.branch_id, Device.terminal_code)))
    online = await online_devices([d.id for d in devices])
    now = datetime.now(UTC)
    failed = await db.scalars(
        select(SyncOperation)
        .where(
            SyncOperation.company_id == principal.company_id,
            SyncOperation.status.in_([OperationStatus.REJECTED, OperationStatus.CONFLICT]),
            SyncOperation.received_at >= now - timedelta(days=30),
            SyncOperation.device_id.in_([d.id for d in devices]),
        )
        .order_by(SyncOperation.received_at.desc())
        .limit(200)
    )
    return SyncMonitorResponse(
        devices=[
            MonitoredDevice(
                id=d.id,
                branch_id=d.branch_id,
                terminal_code=d.terminal_code,
                name=d.name,
                app_version=d.app_version,
                online=d.id in online,
                last_seen_at=d.last_seen_at,
                last_sync_at=d.last_sync_at,
                pending_operations=d.pending_operations,
                stale=not d.last_sync_at or now - d.last_sync_at > STALE_AFTER,
            )
            for d in devices
        ],
        failed_operations=[FailedOperation.model_validate(op) for op in failed],
    )
