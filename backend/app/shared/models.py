"""SQLAlchemy declarative base and reusable column mixins."""

import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, MetaData, Numeric, func
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column

from app.shared.ids import new_id

# Deterministic constraint names so Alembic migrations are stable and reviewable.
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# Column types for money-like values. Use these instead of bare Numeric to keep scales uniform.
Money = Numeric(14, 2)
UnitCost = Numeric(14, 4)
Quantity = Numeric(14, 3)
Rate = Numeric(6, 3)


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {
        datetime: DateTime(timezone=True),
        Decimal: Money,
    }


class UUIDPrimaryKeyMixin:
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=new_id)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), onupdate=func.now())


class CompanyScopedMixin:
    @declared_attr
    def company_id(cls) -> Mapped[uuid.UUID]:  # noqa: N805
        return mapped_column(ForeignKey("companies.id", ondelete="RESTRICT"), index=True)


class SyncTrackedMixin:
    """Tables that POS terminals download.

    `sync_txid` is set by a database trigger to the writing transaction's id. See
    docs/SYNC_PROTOCOL.md#pull for why this (and not updated_at) is the pull cursor.

    Each sync-tracked table declares `sync_index(<table>)` in `__table_args__` so pulls can use
    a (company_id, sync_txid) index.
    """

    sync_txid: Mapped[int | None] = mapped_column(BigInteger)


def sync_index(table: str) -> Index:
    return Index(f"ix_{table}_company_sync", "company_id", "sync_txid")
