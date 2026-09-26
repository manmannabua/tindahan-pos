import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.shared.models import (
    Base,
    CompanyScopedMixin,
    SyncTrackedMixin,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    sync_index,
)


class User(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        # Email is globally unique (login identifier), case-insensitive.
        Index("uq_users_email_lower", func.lower(text("email")), unique=True),
        UniqueConstraint("company_id", "username"),
        sync_index("users"),
    )

    email: Mapped[str] = mapped_column(String(254))
    username: Mapped[str] = mapped_column(String(64))
    full_name: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(255))

    # POS PIN: argon2 hash for online verification, PBKDF2 verifier for offline verification.
    # See docs/SECURITY.md#offline-authentication.
    pin_hash: Mapped[str | None] = mapped_column(String(255))
    pin_offline_salt: Mapped[str | None] = mapped_column(String(64))
    pin_offline_verifier: Mapped[str | None] = mapped_column(String(128))
    pin_offline_iterations: Mapped[int | None] = mapped_column(Integer)
    pin_updated_at: Mapped[datetime | None]

    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))
    last_login_at: Mapped[datetime | None]

    role_assignments: Mapped[list["UserRole"]] = relationship(
        back_populates="user", lazy="raise", cascade="all, delete-orphan"
    )


class Role(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, SyncTrackedMixin, Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("company_id", "code"), sync_index("roles"))

    code: Mapped[str] = mapped_column(String(32))
    name: Mapped[str] = mapped_column(String(100))
    description: Mapped[str | None] = mapped_column(String(500))
    is_system: Mapped[bool] = mapped_column(Boolean, server_default=text("false"))

    permissions: Mapped[list["RolePermission"]] = relationship(
        back_populates="role", lazy="raise", cascade="all, delete-orphan"
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True
    )
    permission: Mapped[str] = mapped_column(String(64), primary_key=True)

    role: Mapped[Role] = relationship(back_populates="permissions", lazy="raise")


class UserRole(UUIDPrimaryKeyMixin, Base):
    """Role assignment. `branch_id = NULL` means the role applies to all branches."""

    __tablename__ = "user_roles"
    __table_args__ = (
        UniqueConstraint("user_id", "role_id", "branch_id", postgresql_nulls_not_distinct=True),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    role_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("roles.id", ondelete="CASCADE"), index=True
    )
    branch_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("branches.id", ondelete="CASCADE")
    )

    user: Mapped[User] = relationship(back_populates="role_assignments", lazy="raise")
    role: Mapped[Role] = relationship(lazy="raise")
