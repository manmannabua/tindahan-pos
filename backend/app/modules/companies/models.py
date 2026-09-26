from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, Index, String, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.modules.companies.features import effective
from app.shared.models import Base, SyncTrackedMixin, TimestampMixin, UUIDPrimaryKeyMixin


class Company(UUIDPrimaryKeyMixin, TimestampMixin, SyncTrackedMixin, Base):
    """Tenant root. Every business using the system is one company."""

    __tablename__ = "companies"
    __table_args__ = (Index("ix_companies_sync_txid", "sync_txid"),)

    code: Mapped[str] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    legal_name: Mapped[str | None] = mapped_column(String(200))
    tin: Mapped[str | None] = mapped_column(String(32))
    currency: Mapped[str] = mapped_column(String(3), server_default="PHP")
    timezone: Mapped[str] = mapped_column(String(64), server_default="Asia/Manila")
    prices_include_tax: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    # BIR: receipts say "VAT REG TIN" or "NON-VAT REG TIN".
    vat_registered: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    bir_accreditation_no: Mapped[str | None] = mapped_column(String(64))
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, server_default=text("'{}'::jsonb"))
    # Explicit on/off choices per optional feature (companies/features.py); missing = on.
    feature_choices: Mapped[dict[str, Any]] = mapped_column(
        "features", JSONB, server_default=text("'{}'::jsonb")
    )
    # Null until the owner finishes (or skips) the onboarding wizard.
    onboarding_completed_at: Mapped[datetime | None]
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))

    @property
    def features(self) -> dict[str, bool]:
        """Every optional feature with its effective state (dependencies applied)."""
        return {f.value: on for f, on in effective(self.feature_choices).items()}

    @property
    def onboarding_completed(self) -> bool:
        return self.onboarding_completed_at is not None

    def has_feature(self, feature: str) -> bool:
        return self.features.get(feature, True)
