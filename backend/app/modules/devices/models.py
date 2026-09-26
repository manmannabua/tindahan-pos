import uuid
from datetime import date, datetime
from enum import StrEnum

from sqlalchemy import CheckConstraint, Date, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.modules.branches.models import Branch
from app.shared.models import (
    Base,
    CompanyScopedMixin,
    SyncTrackedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    sync_index,
)


class DeviceStatus(StrEnum):
    ACTIVE = "ACTIVE"
    REVOKED = "REVOKED"


class Device(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    """A registered POS terminal. See docs/DEVICE_MANAGEMENT.md."""

    __tablename__ = "devices"
    __table_args__ = (
        CheckConstraint("status IN ('ACTIVE', 'REVOKED')", name="status"),
        sync_index("devices"),
        # Terminal codes are unique per branch among devices that are still in use.
        Index(
            "uq_devices_branch_terminal_active",
            "branch_id",
            "terminal_code",
            unique=True,
            postgresql_where=text("status <> 'REVOKED'"),
        ),
    )

    branch_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("branches.id", ondelete="RESTRICT"), index=True
    )
    terminal_code: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(100))
    platform: Mapped[str | None] = mapped_column(String(200))
    app_version: Mapped[str | None] = mapped_column(String(32))
    public_key: Mapped[str] = mapped_column(Text)  # PEM, ECDSA P-256
    status: Mapped[DeviceStatus] = mapped_column(String(16), default=DeviceStatus.ACTIVE)

    registered_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    registered_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    revoked_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))

    # BIR registration of this terminal (printed on receipts and readings).
    bir_min: Mapped[str | None] = mapped_column(String(32))  # Machine Identification Number
    bir_serial_number: Mapped[str | None] = mapped_column(String(64))
    bir_ptu_number: Mapped[str | None] = mapped_column(String(64))  # Permit to Use
    bir_ptu_issued_on: Mapped[date | None] = mapped_column(Date)

    last_seen_at: Mapped[datetime | None]
    last_sync_at: Mapped[datetime | None]
    pending_operations: Mapped[int | None] = mapped_column(Integer)

    branch: Mapped[Branch] = relationship(lazy="raise")

    @property
    def is_active(self) -> bool:
        return self.status == DeviceStatus.ACTIVE
