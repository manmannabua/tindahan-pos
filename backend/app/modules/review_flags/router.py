import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import Field

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_permission,
)
from app.modules.review_flags import service
from app.modules.review_flags.models import FlagStatus, FlagType
from app.modules.users.permissions import P
from app.shared.schemas import Page, ResponseSchema, Schema

router = APIRouter(prefix="/review-flags", tags=["review flags"])
_manage = [Depends(require_permission(P.REVIEW_FLAGS_MANAGE))]


class ReviewFlagRead(ResponseSchema):
    id: uuid.UUID
    flag_type: FlagType
    branch_id: uuid.UUID | None
    stock_location_id: uuid.UUID | None
    entity_type: str
    entity_id: str
    details: dict[str, Any]
    occurrences: int
    status: FlagStatus
    first_seen_at: datetime
    last_seen_at: datetime
    resolved_by_id: uuid.UUID | None
    resolved_at: datetime | None
    resolution_note: str | None


class ResolveFlagRequest(Schema):
    status: FlagStatus = FlagStatus.RESOLVED
    note: str | None = Field(default=None, max_length=500)


@router.get("", response_model=Page[ReviewFlagRead], dependencies=_manage)
async def list_flags(
    principal: CurrentPrincipal,
    db: DbSession,
    status: FlagStatus | None = FlagStatus.OPEN,
    flag_type: FlagType | None = None,
    branch_id: uuid.UUID | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ReviewFlagRead]:
    rows, total = await service.list_flags(
        db,
        principal,
        status=status,
        flag_type=flag_type,
        branch_id=branch_id,
        limit=limit,
        offset=offset,
    )
    return Page(
        items=[ReviewFlagRead.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/{flag_id}/resolve", response_model=ReviewFlagRead, dependencies=_manage)
async def resolve_flag(
    flag_id: uuid.UUID,
    data: ResolveFlagRequest,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> ReviewFlagRead:
    flag = await service.resolve_flag(
        db,
        principal,
        flag_id,
        status=data.status,
        note=data.note,
        actor=audit_actor(principal, request),
    )
    return ReviewFlagRead.model_validate(flag)
