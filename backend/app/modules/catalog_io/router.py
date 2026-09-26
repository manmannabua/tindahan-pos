import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, Request, Response, UploadFile, status

from app.core.config import get_settings
from app.core.database import get_sessionmaker
from app.modules.audit import service as audit
from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_permission,
)
from app.modules.catalog_io import service
from app.modules.catalog_io.models import ImportJob
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.exceptions import BusinessRuleError
from app.shared.schemas import ResponseSchema

router = APIRouter(tags=["import / export"])
MAX_UPLOAD_BYTES = 10 * 1024 * 1024


class ImportJobRead(ResponseSchema):
    id: uuid.UUID
    kind: str
    status: str
    filename: str
    result: dict[str, Any] | None
    error: str | None


@router.post(
    "/imports/products",
    response_model=ImportJobRead,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(require_permission(P.PRODUCTS_WRITE))],
)
async def import_products(
    file: UploadFile,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
    background: BackgroundTasks,
    stock_location_id: uuid.UUID | None = None,
) -> ImportJobRead:
    """Upload a products CSV (UTF-8; Excel "CSV UTF-8" works). Poll the job for the result."""
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise BusinessRuleError("File is larger than 10 MB", code="import.too_large")
    try:
        content = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise BusinessRuleError("File must be UTF-8 encoded CSV", code="import.encoding") from exc
    job = ImportJob(
        company_id=principal.company_id,
        kind="products",
        filename=(file.filename or "products.csv")[:200],
        content=content,
        options={"stock_location_id": str(stock_location_id) if stock_location_id else None},
        requested_by_id=principal.user_id,
    )
    db.add(job)
    await db.flush()
    audit.record(
        db,
        audit_actor(principal, request),
        "import.requested",
        entity_type="import_job",
        entity_id=job.id,
        metadata={"filename": job.filename, "bytes": len(raw)},
    )
    await db.commit()

    if get_settings().background_jobs_inline:

        async def run() -> None:
            async with get_sessionmaker()() as session:
                await service.run_product_import(session, job.id)

        background.add_task(run)
    else:
        from app.workers.tasks import import_products_task

        import_products_task.delay(str(job.id))
    return ImportJobRead.model_validate(job)


@router.get("/imports/{job_id}", response_model=ImportJobRead)
async def get_import(
    job_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> ImportJobRead:
    job = await crud.get_scoped(db, ImportJob, principal.company_id, job_id, "import_job")
    return ImportJobRead.model_validate(job)


@router.get("/exports/products.csv", dependencies=[Depends(require_permission(P.PRODUCTS_READ))])
async def export_products(principal: CurrentPrincipal, db: DbSession) -> Response:
    include_cost = principal.has_in_any_scope(P.PRODUCTS_WRITE) or principal.has_in_any_scope(
        P.REPORTS_FINANCIAL
    )
    content = await service.export_products_csv(db, principal, include_cost=include_cost)
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="products.csv"'},
    )
