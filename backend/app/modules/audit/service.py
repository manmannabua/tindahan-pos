"""Audit logging.

`record()` only adds the row to the session: it is committed together with the business change
it describes. An audited change and its audit entry therefore succeed or fail together.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditLog


@dataclass(frozen=True, slots=True)
class AuditActor:
    company_id: uuid.UUID | None
    user_id: uuid.UUID | None = None
    device_id: uuid.UUID | None = None
    ip_address: str | None = None


def record(
    db: AsyncSession,
    actor: AuditActor,
    action: str,
    *,
    entity_type: str | None = None,
    entity_id: uuid.UUID | str | None = None,
    branch_id: uuid.UUID | None = None,
    changes: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    occurred_at: datetime | None = None,
) -> AuditLog:
    entry = AuditLog(
        company_id=actor.company_id,
        user_id=actor.user_id,
        device_id=actor.device_id,
        ip_address=actor.ip_address,
        branch_id=branch_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id is not None else None,
        changes=changes,
        extra=metadata,
    )
    if occurred_at is not None:
        entry.occurred_at = occurred_at
    db.add(entry)
    return entry


def diff(before: dict[str, Any], after: dict[str, Any]) -> dict[str, Any]:
    """Field-level diff for audit `changes`: {field: [old, new]} for changed fields only."""
    return {
        key: [_jsonable(before.get(key)), _jsonable(value)]
        for key, value in after.items()
        if before.get(key) != value
    }


def _jsonable(value: Any) -> Any:
    if isinstance(value, (uuid.UUID, datetime, Decimal)):
        return str(value)
    return value
