import uuid
from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.shared.models import Base, CompanyScopedMixin, Money, TimestampMixin, UUIDPrimaryKeyMixin


class ExpenseCategory(UUIDPrimaryKeyMixin, CompanyScopedMixin, TimestampMixin, Base):
    __tablename__ = "expense_categories"
    __table_args__ = (UniqueConstraint("company_id", "name"),)

    name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, server_default=text("true"))


DEFAULT_EXPENSE_CATEGORIES = [
    "Rent",
    "Utilities",
    "Salaries",
    "Supplies",
    "Transportation",
    "Repairs & Maintenance",
    "Taxes & Licenses",
    "Other",
]


class PaidFrom(StrEnum):
    CASH_DRAWER = "CASH_DRAWER"
    PETTY_CASH = "PETTY_CASH"
    BANK = "BANK"
    EWALLET = "EWALLET"
    OTHER = "OTHER"


class Expense(UUIDPrimaryKeyMixin, CompanyScopedMixin, Base):
    """An operating expense. Drawer payouts are recorded at the POS as cash movements; this
    table is the accounting view (the two can be linked by `cash_movement_id`)."""

    __tablename__ = "expenses"
    __table_args__ = (
        CheckConstraint("amount > 0", name="amount_positive"),
        CheckConstraint(
            "paid_from IN ('CASH_DRAWER', 'PETTY_CASH', 'BANK', 'EWALLET', 'OTHER')",
            name="paid_from",
        ),
        Index("ix_expenses_company_date", "company_id", "expense_date"),
    )

    branch_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("branches.id"), index=True)
    category_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("expense_categories.id"))
    expense_date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Money)
    paid_from: Mapped[PaidFrom] = mapped_column(String(16))
    payee: Mapped[str | None] = mapped_column(String(200))
    reference_no: Mapped[str | None] = mapped_column(String(100))
    description: Mapped[str] = mapped_column(String(500))
    cash_movement_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("cash_movements.id"))
    recorded_by_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    voided_at: Mapped[datetime | None]
    voided_by_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id"))
