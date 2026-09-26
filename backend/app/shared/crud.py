"""Shared helpers for simple company-scoped reference data (categories, brands, units, ...).

These entities are plain lists edited in the admin portal. Keeping their CRUD mechanics in one
place avoids five copies of the same code; anything with real business rules gets its own
service.
"""

import uuid
from typing import Any, cast

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.shared.exceptions import ConflictError, NotFoundError
from app.shared.models import Base
from app.shared.patch import apply_patch


async def get_scoped[M: Base](
    db: AsyncSession, model: type[M], company_id: uuid.UUID, entity_id: uuid.UUID, label: str
) -> M:
    stmt: Select[Any] = select(model).where(
        model.company_id == company_id,  # type: ignore[attr-defined]
        model.id == entity_id,  # type: ignore[attr-defined]
    )
    obj = cast("M | None", await db.scalar(stmt))
    if obj is None:
        raise NotFoundError(
            f"{label.replace('_', ' ').capitalize()} not found", code=f"{label}.not_found"
        )
    return obj


async def ensure_unique(
    db: AsyncSession,
    stmt: Select[Any],
    label: str,
    field: str,
    *,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Raise 409 if `stmt` (a select of the entity's id) finds a different row."""
    existing = await db.scalar(stmt.limit(1))
    if existing is not None and existing != exclude_id:
        raise ConflictError(f"{field.capitalize()} already in use", code=f"{label}.{field}_taken")


def ci_equals(column: Any, value: str) -> Any:
    return func.lower(column) == value.lower()


async def create_entity[M: Base](db: AsyncSession, obj: M, actor: AuditActor, label: str) -> M:
    db.add(obj)
    await db.flush()
    audit.record(
        db,
        actor,
        f"{label}.created",
        entity_type=label,
        entity_id=obj.id,  # type: ignore[attr-defined]
    )
    await db.commit()
    return obj


async def update_entity[M: Base](
    db: AsyncSession,
    obj: M,
    values: dict[str, Any],
    actor: AuditActor,
    label: str,
    *,
    nullable: set[str] | None = None,
) -> M:
    changes = apply_patch(obj, values, nullable or set())
    if changes:
        audit.record(
            db,
            actor,
            f"{label}.updated",
            entity_type=label,
            entity_id=obj.id,  # type: ignore[attr-defined]
            changes=changes,
        )
    await db.commit()
    await db.refresh(obj)
    return obj
