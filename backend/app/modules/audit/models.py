import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import ForeignKey, Index, String, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import Base, UUIDPrimaryKeyMixin


class AuditLog(UUIDPrimaryKeyMixin, Base):
    """Append-only record of sensitive actions. UPDATE/DELETE are blocked by a trigger."""

    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_company_occurred", "company_id", text("occurred_at DESC")),
        Index("ix_audit_logs_entity", "entity_type", "entity_id"),
    )

    # No FK to companies: audit rows must survive anything, and must never block a delete
    # cascade elsewhere. Referential integrity is not the point of an audit log.
    company_id: Mapped[uuid.UUID | None]
    branch_id: Mapped[uuid.UUID | None]
    user_id: Mapped[uuid.UUID | None]
    device_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("devices.id", ondelete="SET NULL")
    )
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str | None] = mapped_column(String(64))
    entity_id: Mapped[str | None] = mapped_column(String(64))
    changes: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    extra: Mapped[dict[str, Any] | None] = mapped_column("metadata", JSONB)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    occurred_at: Mapped[datetime] = mapped_column(server_default=func.now())
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
