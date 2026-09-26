from sqlalchemy import Boolean, Index, String, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import (
    Base,
    CompanyScopedMixin,
    SyncTrackedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    sync_index,
)


class Brand(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    __tablename__ = "brands"
    __table_args__ = (
        Index("uq_brands_company_name_lower", "company_id", func.lower(text("name")), unique=True),
        sync_index("brands"),
    )

    name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
