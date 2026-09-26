"""Raising and resolving review flags."""

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.review_flags.models import FlagStatus, FlagType, ReviewFlag
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.exceptions import BusinessRuleError


async def raise_flag(
    db: AsyncSession,
    *,
    company_id: uuid.UUID,
    flag_type: FlagType,
    entity_type: str,
    entity_id: uuid.UUID | str,
    details: dict[str, Any],
    branch_id: uuid.UUID | None = None,
    stock_location_id: uuid.UUID | None = None,
) -> None:
    """Open a flag, or bump the existing OPEN flag for the same subject.

    `details` of repeat occurrences are merged; list values are appended (e.g. triggering sales).
    """
    stmt = insert(ReviewFlag).values(
        company_id=company_id,
        flag_type=flag_type.value,
        entity_type=entity_type,
        entity_id=str(entity_id),
        details=details,
        branch_id=branch_id,
        stock_location_id=stock_location_id,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["company_id", "flag_type", "entity_type", "entity_id", "stock_location_id"],
        index_where=text("status = 'OPEN'"),
        set_={
            "occurrences": ReviewFlag.occurrences + 1,
            "last_seen_at": func.now(),
            "details": _MERGE_DETAILS_SQL,
        },
    )
    await db.execute(stmt)


# Merge an OPEN flag's details with a new occurrence: array values are concatenated (e.g. the
# sales that drove stock negative), other keys take the newest value.
_MERGE_DETAILS_SQL = text(
    "(SELECT jsonb_object_agg(k, CASE "
    "WHEN jsonb_typeof(review_flags.details -> k) = 'array' "
    "AND jsonb_typeof(excluded.details -> k) = 'array' "
    "THEN (review_flags.details -> k) || (excluded.details -> k) "
    "ELSE COALESCE(excluded.details -> k, review_flags.details -> k) END) "
    "FROM (SELECT jsonb_object_keys(review_flags.details || excluded.details) AS k) keys)"
)


async def list_flags(
    db: AsyncSession,
    principal: Principal,
    *,
    status: FlagStatus | None,
    flag_type: FlagType | None,
    branch_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> tuple[list[ReviewFlag], int]:
    stmt = select(ReviewFlag).where(ReviewFlag.company_id == principal.company_id)
    scope = principal.branch_scope(P.REVIEW_FLAGS_MANAGE)
    if scope is not None:
        stmt = stmt.where(ReviewFlag.branch_id.in_(scope))
    if status:
        stmt = stmt.where(ReviewFlag.status == status)
    if flag_type:
        stmt = stmt.where(ReviewFlag.flag_type == flag_type)
    if branch_id:
        stmt = stmt.where(ReviewFlag.branch_id == branch_id)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.scalars(
        stmt.order_by(ReviewFlag.last_seen_at.desc()).limit(limit).offset(offset)
    )
    return list(rows), total


async def resolve_flag(
    db: AsyncSession,
    principal: Principal,
    flag_id: uuid.UUID,
    *,
    status: FlagStatus,
    note: str | None,
    actor: AuditActor,
) -> ReviewFlag:
    flag = await crud.get_scoped(db, ReviewFlag, principal.company_id, flag_id, "review_flag")
    principal.require(P.REVIEW_FLAGS_MANAGE, flag.branch_id)
    if status == FlagStatus.OPEN:
        raise BusinessRuleError("Use RESOLVED or DISMISSED", code="review_flag.invalid_status")
    if flag.status != FlagStatus.OPEN:
        raise BusinessRuleError("Flag is already closed", code="review_flag.closed")
    flag.status = status
    flag.resolved_by_id = principal.user_id
    flag.resolved_at = datetime.now(UTC)
    flag.resolution_note = note
    audit.record(
        db,
        actor,
        "review_flag.closed",
        entity_type="review_flag",
        entity_id=flag.id,
        branch_id=flag.branch_id,
        metadata={"status": status.value, "flag_type": flag.flag_type, "note": note},
    )
    await db.commit()
    return flag
