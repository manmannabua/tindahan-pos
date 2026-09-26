import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import Base, CompanyScopedMixin, UUIDPrimaryKeyMixin


class ImportJob(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    """A CSV import processed in the background (Celery, or in-process in development)."""

    __tablename__ = "import_jobs"
    __table_args__ = (
        CheckConstraint("status IN ('PENDING', 'RUNNING', 'DONE', 'FAILED')", name="status"),
    )

    kind: Mapped[str] = mapped_column(String(32))  # "products"
    status: Mapped[str] = mapped_column(String(16), server_default="PENDING")
    filename: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(Text)
    options: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default="{}")
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(String(1000))
    requested_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    finished_at: Mapped[datetime | None]
