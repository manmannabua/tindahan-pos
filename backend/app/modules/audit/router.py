import base64
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, or_, select

from app.modules.audit.models import AuditLog
from app.modules.auth.dependencies import CurrentPrincipal, DbSession, require_permission
from app.modules.users.permissions import P
from app.shared.exceptions import BusinessRuleError
from app.shared.schemas import ResponseSchema

router = APIRouter(prefix="/audit-logs", tags=["audit"])


class AuditLogRead(ResponseSchema):
    id: uuid.UUID
    branch_id: uuid.UUID | None
    user_id: uuid.UUID | None
    device_id: uuid.UUID | None
    action: str
    entity_type: str | None
    entity_id: str | None
    changes: dict[str, Any] | None
    extra: dict[str, Any] | None
    ip_address: str | None
    occurred_at: datetime


class AuditLogPage(ResponseSchema):
    items: list[AuditLogRead]
    next_cursor: str | None


def _encode_cursor(entry: AuditLog) -> str:
    return base64.urlsafe_b64encode(f"{entry.occurred_at.isoformat()}|{entry.id}".encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    try:
        ts, id_ = base64.urlsafe_b64decode(cursor.encode()).decode().split("|")
        return datetime.fromisoformat(ts), uuid.UUID(id_)
    except ValueError as exc:
        raise BusinessRuleError("Invalid cursor", code="pagination.invalid_cursor") from exc


@router.get(
    "", response_model=AuditLogPage, dependencies=[Depends(require_permission(P.AUDIT_VIEW))]
)
async def list_audit_logs(
    principal: CurrentPrincipal,
    db: DbSession,
    action: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    user_id: uuid.UUID | None = None,
    branch_id: uuid.UUID | None = None,
    occurred_from: datetime | None = None,
    occurred_to: datetime | None = None,
    cursor: str | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
) -> AuditLogPage:
    """Newest first, keyset-paginated (stable and fast on large tables, unlike OFFSET)."""
    stmt = select(AuditLog).where(AuditLog.company_id == principal.company_id)
    filters = {
        AuditLog.action: action,
        AuditLog.entity_type: entity_type,
        AuditLog.entity_id: entity_id,
        AuditLog.user_id: user_id,
        AuditLog.branch_id: branch_id,
    }
    for column, value in filters.items():
        if value is not None:
            stmt = stmt.where(column == value)
    if occurred_from:
        stmt = stmt.where(AuditLog.occurred_at >= occurred_from)
    if occurred_to:
        stmt = stmt.where(AuditLog.occurred_at < occurred_to)
    if cursor:
        ts, last_id = _decode_cursor(cursor)
        stmt = stmt.where(
            or_(AuditLog.occurred_at < ts, and_(AuditLog.occurred_at == ts, AuditLog.id < last_id))
        )
    rows = list(
        await db.scalars(
            stmt.order_by(AuditLog.occurred_at.desc(), AuditLog.id.desc()).limit(limit + 1)
        )
    )
    has_more = len(rows) > limit
    rows = rows[:limit]
    return AuditLogPage(
        items=[AuditLogRead.model_validate(r) for r in rows],
        next_cursor=_encode_cursor(rows[-1]) if has_more and rows else None,
    )
