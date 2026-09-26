import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated

from pydantic import Field

from app.modules.expenses.models import PaidFrom
from app.shared.schemas import ResponseSchema, Schema

PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]


class ExpenseCategoryRead(ResponseSchema):
    id: uuid.UUID
    name: str
    is_active: bool


class ExpenseCategoryCreate(Schema):
    name: str = Field(min_length=1, max_length=100)


class ExpenseCreate(Schema):
    branch_id: uuid.UUID
    category_id: uuid.UUID
    expense_date: date
    amount: PositiveMoney
    paid_from: PaidFrom
    payee: str | None = Field(default=None, max_length=200)
    reference_no: str | None = Field(default=None, max_length=100)
    description: str = Field(min_length=2, max_length=500)
    cash_movement_id: uuid.UUID | None = None


class ExpenseRead(ResponseSchema):
    id: uuid.UUID
    branch_id: uuid.UUID
    category_id: uuid.UUID
    expense_date: date
    amount: Decimal
    paid_from: PaidFrom
    payee: str | None
    reference_no: str | None
    description: str
    cash_movement_id: uuid.UUID | None
    recorded_by_id: uuid.UUID
    created_at: datetime
    voided_at: datetime | None
