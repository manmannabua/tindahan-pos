"""Celery tasks. Keep each task idempotent (it may run more than once)."""

import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_sync_sessionmaker
from app.core.logging import get_logger
from app.modules.auth.models import RefreshToken
from app.modules.companies.models import Company
from app.modules.inventory.service import verify_balances
from app.modules.review_flags.models import FlagType
from app.modules.review_flags.service import raise_flag
from app.workers.celery_app import celery_app
from app.workers.runtime import run_async

log = get_logger(__name__)


def purge_expired_refresh_tokens(retention_days: int = 30) -> int:
    """Delete refresh tokens that expired or were revoked more than `retention_days` ago.

    Recently revoked tokens are kept for a while so reuse detection still works for them.
    """
    cutoff = datetime.now(UTC) - timedelta(days=retention_days)
    with get_sync_sessionmaker()() as session, session.begin():
        result = session.execute(
            delete(RefreshToken).where(
                or_(RefreshToken.expires_at < cutoff, RefreshToken.revoked_at < cutoff)
            )
        )
    deleted = int(result.rowcount or 0)  # type: ignore[attr-defined]
    log.info("maintenance.refresh_tokens_purged", deleted=deleted)
    return deleted


@celery_app.task(name="maintenance.purge_expired_refresh_tokens")
def purge_expired_refresh_tokens_task() -> int:
    return purge_expired_refresh_tokens()


async def verify_inventory_balances(db: AsyncSession) -> int:
    """Compare every balance with its ledger sum and flag drift (should never happen)."""
    drifts = 0
    for company_id in await db.scalars(select(Company.id).where(Company.is_active.is_(True))):
        for location_id, variant_id, balance, ledger in await verify_balances(db, company_id):
            drifts += 1
            await raise_flag(
                db,
                company_id=company_id,
                flag_type=FlagType.BALANCE_DRIFT,
                entity_type="product_variant",
                entity_id=variant_id,
                stock_location_id=location_id,
                details={"balance": str(balance), "ledger": str(ledger)},
            )
    await db.commit()
    log.info("inventory.balances_verified", drifts=drifts)
    return drifts


@celery_app.task(name="inventory.verify_balances")
def verify_inventory_balances_task() -> int:
    return run_async(verify_inventory_balances)


@celery_app.task(name="reports.export")
def export_report_task(export_id: str) -> None:
    from app.modules.reporting.exports import build_export

    run_async(lambda db: build_export(db, uuid.UUID(export_id)))


@celery_app.task(name="imports.products")
def import_products_task(job_id: str) -> None:
    from app.modules.catalog_io.service import run_product_import

    run_async(lambda db: run_product_import(db, uuid.UUID(job_id)))


def purge_job_payloads(export_days: int = 7, import_days: int = 30) -> tuple[int, int]:
    """Drop stored CSV payloads of old export/import jobs; the job rows (who/when/result) stay."""
    from app.modules.catalog_io.models import ImportJob
    from app.modules.reporting.models import ReportExport

    now = datetime.now(UTC)
    with get_sync_sessionmaker()() as session, session.begin():
        exports = session.execute(
            update(ReportExport)
            .where(
                ReportExport.created_at < now - timedelta(days=export_days),
                ReportExport.content.is_not(None),
            )
            .values(content=None)
        )
        imports = session.execute(
            update(ImportJob)
            .where(
                ImportJob.created_at < now - timedelta(days=import_days), ImportJob.content != ""
            )
            .values(content="")
        )
    counts = (int(exports.rowcount or 0), int(imports.rowcount or 0))  # type: ignore[attr-defined]
    log.info("maintenance.job_payloads_purged", exports=counts[0], imports=counts[1])
    return counts


@celery_app.task(name="maintenance.purge_job_payloads")
def purge_job_payloads_task() -> tuple[int, int]:
    return purge_job_payloads()
