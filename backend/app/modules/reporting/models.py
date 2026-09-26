"""Background report exports (Celery). Small businesses' exports fit comfortably in the database;
move `content` to object storage if exports grow large."""

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import Base, CompanyScopedMixin, UUIDPrimaryKeyMixin


class ExportStatus(StrEnum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"


class ReportExport(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    __tablename__ = "report_exports"
    __table_args__ = (
        CheckConstraint("status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')", name="status"),
    )

    report: Mapped[str] = mapped_column(String(64))
    params: Mapped[dict[str, Any]] = mapped_column(JSONB)
    status: Mapped[ExportStatus] = mapped_column(String(16), server_default="PENDING")
    requested_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    filename: Mapped[str | None] = mapped_column(String(200))
    content: Mapped[str | None] = mapped_column(Text)
    row_count: Mapped[int | None]
    error: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    finished_at: Mapped[datetime | None]
