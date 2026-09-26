"""Report exports: run a report in the background and store the CSV."""

import uuid
from datetime import UTC, date, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.companies.models import Company
from app.modules.reporting.models import ExportStatus, ReportExport
from app.modules.reporting.period import make_period
from app.modules.reporting.registry import REPORTS, redact, to_csv
from app.modules.reporting.service import Scope

log = get_logger(__name__)


async def build_export(db: AsyncSession, export_id: uuid.UUID) -> None:
    export = await db.get(ReportExport, export_id)
    if export is None or export.status not in (ExportStatus.PENDING, ExportStatus.FAILED):
        return  # already done (task redelivered) — idempotent
    export.status = ExportStatus.RUNNING
    await db.commit()
    try:
        company = await db.get(Company, export.company_id)
        assert company is not None  # noqa: S101
        params = export.params
        period = make_period(
            date.fromisoformat(params["date_from"]),
            date.fromisoformat(params["date_to"]),
            company.timezone,
        )
        scope = Scope(
            company_id=export.company_id,
            period=period,
            branch_ids={uuid.UUID(b) for b in params["branch_scope"]}
            if params.get("branch_scope") is not None
            else None,
            branch_id=uuid.UUID(params["branch_id"]) if params.get("branch_id") else None,
        )
        definition = REPORTS[export.report]
        data = await definition.run(db, scope, params.get("options", {}))
        if not params.get("financial"):
            data = redact(data, definition.financial)
        content, rows = to_csv(data)
        export.content = content
        export.row_count = rows
        export.filename = f"{export.report}_{period.date_from}_{period.date_to}.csv"
        export.status = ExportStatus.DONE
    except Exception as exc:
        log.exception("report.export_failed", export_id=str(export_id))
        await db.rollback()
        export = await db.get(ReportExport, export_id)
        assert export is not None  # noqa: S101
        export.status = ExportStatus.FAILED
        export.error = str(exc)[:1000]
    export.finished_at = datetime.now(UTC)
    await db.commit()
