import json
import uuid
from contextlib import suppress
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request, Response, status
from redis.exceptions import RedisError

from app.core.config import get_settings
from app.core.database import get_sessionmaker
from app.core.redis import get_redis
from app.modules.audit import service as audit
from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    ensure_feature,
    require_permission,
)
from app.modules.auth.principal import Principal
from app.modules.companies.models import Company
from app.modules.reporting.exports import build_export
from app.modules.reporting.models import ReportExport
from app.modules.reporting.period import make_period
from app.modules.reporting.registry import REPORTS, cache_key, redact, to_jsonable
from app.modules.reporting.service import Scope
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.exceptions import BusinessRuleError, NotFoundError
from app.shared.schemas import ResponseSchema

router = APIRouter(prefix="/reports", tags=["reports"])
_view = [Depends(require_permission(P.REPORTS_VIEW))]
CACHE_TTL_SECONDS = 60


class ReportInfo(ResponseSchema):
    name: str
    title: str
    has_financial_fields: bool


class ReportResult(ResponseSchema):
    report: str
    title: str
    date_from: date
    date_to: date
    timezone: str
    branch_id: uuid.UUID | None
    financial: bool
    data: Any


class ExportRead(ResponseSchema):
    id: uuid.UUID
    report: str
    status: str
    filename: str | None
    row_count: int | None
    error: str | None


def _definition(name: str) -> Any:
    definition = REPORTS.get(name)
    if definition is None:
        raise NotFoundError(f"Unknown report '{name}'", code="report.unknown")
    return definition


def _options(
    granularity: str | None, limit: int | None, device_id: uuid.UUID | None = None
) -> dict[str, Any]:
    raw = {
        "granularity": granularity,
        "limit": limit,
        "device_id": str(device_id) if device_id else None,
    }
    return {k: v for k, v in raw.items() if v is not None}


@router.get("", response_model=list[ReportInfo], dependencies=_view)
async def list_reports(principal: CurrentPrincipal, db: DbSession) -> list[ReportInfo]:
    """Reports of the features this business uses."""
    company = await db.get(Company, principal.company_id)
    return [
        ReportInfo(name=name, title=d.title, has_financial_fields=bool(d.financial))
        for name, d in REPORTS.items()
        if d.feature is None or (company is not None and company.has_feature(d.feature))
    ]


@router.get("/{name}", response_model=ReportResult, dependencies=_view)
async def run_report(
    name: str,
    principal: CurrentPrincipal,
    db: DbSession,
    date_from: date | None = None,
    date_to: date | None = None,
    branch_id: uuid.UUID | None = None,
    granularity: Literal["day", "week", "month"] | None = None,
    limit: Annotated[int | None, Query(ge=1, le=500)] = None,
    device_id: uuid.UUID | None = None,
) -> ReportResult:
    definition = _definition(name)
    if definition.feature:
        await ensure_feature(db, principal.company_id, definition.feature)
    company = await db.get(Company, principal.company_id)
    assert company is not None  # noqa: S101
    period = make_period(date_from, date_to, company.timezone)
    branch_scope = principal.branch_scope(P.REPORTS_VIEW)
    if branch_id and branch_scope is not None and branch_id not in branch_scope:
        principal.require(P.REPORTS_VIEW, branch_id)
    financial = principal.has_in_any_scope(P.REPORTS_FINANCIAL)
    options = _options(granularity, limit, device_id)

    key = cache_key(
        principal.company_id,
        name,
        {
            "from": period.date_from,
            "to": period.date_to,
            "branch": branch_id,
            "scope": sorted(map(str, branch_scope)) if branch_scope is not None else None,
            "financial": financial,
            **options,
        },
    )
    data = await _cached(key)
    if data is None:
        scope = Scope(principal.company_id, period, branch_scope, branch_id)
        raw = await definition.run(db, scope, options)
        data = to_jsonable(raw if financial else redact(raw, definition.financial))
        await _store(key, data)
    return ReportResult(
        report=name,
        title=definition.title,
        date_from=period.date_from,
        date_to=period.date_to,
        timezone=period.timezone,
        branch_id=branch_id,
        financial=financial,
        data=data,
    )


async def _cached(key: str) -> Any:
    try:
        raw = await get_redis().get(key)
    except RedisError:
        return None
    return json.loads(raw) if raw else None


async def _store(key: str, data: Any) -> None:
    with suppress(RedisError):
        await get_redis().set(key, json.dumps(data), ex=CACHE_TTL_SECONDS)


@router.post(
    "/{name}/export",
    response_model=ExportRead,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=_view,
)
async def export_report(
    name: str,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
    background: BackgroundTasks,
    date_from: date | None = None,
    date_to: date | None = None,
    branch_id: uuid.UUID | None = None,
    granularity: Literal["day", "week", "month"] | None = None,
    limit: Annotated[int | None, Query(ge=1, le=5000)] = None,
    device_id: uuid.UUID | None = None,
) -> ExportRead:
    """Queue a CSV export. Poll `GET /reports/exports/{id}`, then download it."""
    if (definition := _definition(name)).feature:
        await ensure_feature(db, principal.company_id, definition.feature)
    company = await db.get(Company, principal.company_id)
    assert company is not None  # noqa: S101
    period = make_period(date_from, date_to, company.timezone)
    branch_scope = principal.branch_scope(P.REPORTS_VIEW)
    export = ReportExport(
        company_id=principal.company_id,
        report=name,
        requested_by_id=principal.user_id,
        params={
            "date_from": period.date_from.isoformat(),
            "date_to": period.date_to.isoformat(),
            "branch_id": str(branch_id) if branch_id else None,
            "branch_scope": sorted(map(str, branch_scope)) if branch_scope is not None else None,
            "financial": principal.has_in_any_scope(P.REPORTS_FINANCIAL),
            "options": _options(granularity, limit, device_id),
        },
    )
    db.add(export)
    await db.flush()
    audit.record(
        db,
        audit_actor(principal, request),
        "report.exported",
        entity_type="report_export",
        entity_id=export.id,
        metadata={"report": name},
    )
    await db.commit()
    _enqueue(export.id, background)
    return ExportRead.model_validate(export)


def _enqueue(export_id: uuid.UUID, background: BackgroundTasks) -> None:
    if get_settings().background_jobs_inline:
        # Development without a Celery worker: run after the response, in-process.
        async def run() -> None:
            async with get_sessionmaker()() as session:
                await build_export(session, export_id)

        background.add_task(run)
        return
    from app.workers.tasks import export_report_task

    export_report_task.delay(str(export_id))


async def _export_for(db: DbSession, principal: Principal, export_id: uuid.UUID) -> ReportExport:
    export = await crud.get_scoped(
        db, ReportExport, principal.company_id, export_id, "report_export"
    )
    if export.requested_by_id != principal.user_id and not principal.has_in_any_scope(
        P.REPORTS_FINANCIAL
    ):
        raise NotFoundError("Export not found", code="report_export.not_found")
    return export


@router.get("/exports/{export_id}", response_model=ExportRead, dependencies=_view)
async def get_export(
    export_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> ExportRead:
    return ExportRead.model_validate(await _export_for(db, principal, export_id))


@router.get("/exports/{export_id}/download", dependencies=_view)
async def download_export(
    export_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> Response:
    export = await _export_for(db, principal, export_id)
    if export.content is None:
        raise BusinessRuleError("Export is not ready", code="report_export.not_ready")
    return Response(
        content=export.content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{export.filename}"'},
    )
