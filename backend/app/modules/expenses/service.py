import uuid
from datetime import UTC, date, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.branches.models import Branch
from app.modules.cash_management.models import CashMovement
from app.modules.expenses.models import DEFAULT_EXPENSE_CATEGORIES, Expense, ExpenseCategory
from app.modules.expenses.schemas import ExpenseCategoryCreate, ExpenseCreate
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.exceptions import BusinessRuleError


def seed_defaults(db: AsyncSession, company_id: uuid.UUID) -> None:
    for name in DEFAULT_EXPENSE_CATEGORIES:
        db.add(ExpenseCategory(company_id=company_id, name=name))


async def list_categories(db: AsyncSession, company_id: uuid.UUID) -> list[ExpenseCategory]:
    return list(
        await db.scalars(
            select(ExpenseCategory)
            .where(ExpenseCategory.company_id == company_id)
            .order_by(ExpenseCategory.name)
        )
    )


async def create_category(
    db: AsyncSession, principal: Principal, data: ExpenseCategoryCreate, actor: AuditActor
) -> ExpenseCategory:
    principal.require(P.EXPENSES_MANAGE)
    await crud.ensure_unique(
        db,
        select(ExpenseCategory.id).where(
            ExpenseCategory.company_id == principal.company_id,
            crud.ci_equals(ExpenseCategory.name, data.name),
        ),
        "expense_category",
        "name",
    )
    return await crud.create_entity(
        db,
        ExpenseCategory(company_id=principal.company_id, name=data.name),
        actor,
        "expense_category",
    )


async def record_expense(
    db: AsyncSession, principal: Principal, data: ExpenseCreate, actor: AuditActor
) -> Expense:
    principal.require(P.EXPENSES_MANAGE, data.branch_id)
    await crud.get_scoped(db, Branch, principal.company_id, data.branch_id, "branch")
    await crud.get_scoped(
        db, ExpenseCategory, principal.company_id, data.category_id, "expense_category"
    )
    if data.cash_movement_id:
        await crud.get_scoped(
            db, CashMovement, principal.company_id, data.cash_movement_id, "cash_movement"
        )
    expense = Expense(
        company_id=principal.company_id, recorded_by_id=principal.user_id, **data.model_dump()
    )
    db.add(expense)
    await db.flush()
    audit.record(
        db,
        actor,
        "expense.recorded",
        entity_type="expense",
        entity_id=expense.id,
        branch_id=expense.branch_id,
        metadata={"amount": str(expense.amount)},
    )
    await db.commit()
    return expense


async def void_expense(
    db: AsyncSession, principal: Principal, expense_id: uuid.UUID, actor: AuditActor
) -> Expense:
    expense = await crud.get_scoped(db, Expense, principal.company_id, expense_id, "expense")
    principal.require(P.EXPENSES_MANAGE, expense.branch_id)
    if expense.voided_at:
        raise BusinessRuleError("Expense already voided", code="expense.voided")
    expense.voided_at = datetime.now(UTC)
    expense.voided_by_id = principal.user_id
    audit.record(
        db,
        actor,
        "expense.voided",
        entity_type="expense",
        entity_id=expense.id,
        branch_id=expense.branch_id,
    )
    await db.commit()
    return expense


async def list_expenses(
    db: AsyncSession,
    principal: Principal,
    *,
    branch_id: uuid.UUID | None,
    category_id: uuid.UUID | None,
    date_from: date | None,
    date_to: date | None,
    limit: int,
    offset: int,
) -> tuple[list[Expense], int]:
    stmt = select(Expense).where(Expense.company_id == principal.company_id)
    scope = principal.branch_scope(P.EXPENSES_MANAGE)
    if scope is not None:
        stmt = stmt.where(Expense.branch_id.in_(scope))
    if branch_id:
        stmt = stmt.where(Expense.branch_id == branch_id)
    if category_id:
        stmt = stmt.where(Expense.category_id == category_id)
    if date_from:
        stmt = stmt.where(Expense.expense_date >= date_from)
    if date_to:
        stmt = stmt.where(Expense.expense_date <= date_to)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.scalars(
        stmt.order_by(Expense.expense_date.desc(), Expense.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    return list(rows), total
