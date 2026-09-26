"""Server-side idempotency log for pushed operations. See docs/SYNC_PROTOCOL.md §3."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import ForeignKey, Index, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import Base


class OperationStatus(StrEnum):
    APPLIED = "APPLIED"
    REJECTED = "REJECTED"
    CONFLICT = "CONFLICT"


class SyncOperation(Base):
    __tablename__ = "sync_operations"
    __table_args__ = (
        Index("ix_sync_operations_entity", "entity_type", "entity_id"),
        Index("ix_sync_operations_device_received", "device_id", "received_at"),
    )

    # The client's operation_id. Primary key = the idempotency guarantee.
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True)
    company_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("companies.id"), index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id"))
    entity_type: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[uuid.UUID]
    operation: Mapped[str] = mapped_column(String(48))
    payload_hash: Mapped[str] = mapped_column(String(64))
    status: Mapped[OperationStatus] = mapped_column(String(16))
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    client_created_at: Mapped[datetime]
    received_at: Mapped[datetime] = mapped_column(server_default=func.now())
