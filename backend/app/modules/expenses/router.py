import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_feature,
    require_permission,
)
from app.modules.companies.features import Feature
from app.modules.expenses import service
from app.modules.expenses.schemas import (
    ExpenseCategoryCreate,
    ExpenseCategoryRead,
    ExpenseCreate,
    ExpenseRead,
)
from app.modules.users.permissions import P
from app.shared.schemas import Page

router = APIRouter(tags=["expenses"], dependencies=[Depends(require_feature(Feature.EXPENSES))])
_manage = [Depends(require_permission(P.EXPENSES_MANAGE))]


@router.get("/expense-categories", response_model=list[ExpenseCategoryRead], dependencies=_manage)
async def list_categories(principal: CurrentPrincipal, db: DbSession) -> list[ExpenseCategoryRead]:
    rows = await service.list_categories(db, principal.company_id)
    return [ExpenseCategoryRead.model_validate(r) for r in rows]


@router.post(
    "/expense-categories", response_model=ExpenseCategoryRead, status_code=status.HTTP_201_CREATED
)
async def create_category(
    data: ExpenseCategoryCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> ExpenseCategoryRead:
    row = await service.create_category(db, principal, data, audit_actor(principal, request))
    return ExpenseCategoryRead.model_validate(row)


@router.get("/expenses", response_model=Page[ExpenseRead], dependencies=_manage)
async def list_expenses(
    principal: CurrentPrincipal,
    db: DbSession,
    branch_id: uuid.UUID | None = None,
    category_id: uuid.UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ExpenseRead]:
    rows, total = await service.list_expenses(
        db,
        principal,
        branch_id=branch_id,
        category_id=category_id,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    return Page(
        items=[ExpenseRead.model_validate(r) for r in rows], total=total, limit=limit, offset=offset
    )


@router.post("/expenses", response_model=ExpenseRead, status_code=status.HTTP_201_CREATED)
async def record_expense(
    data: ExpenseCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> ExpenseRead:
    row = await service.record_expense(db, principal, data, audit_actor(principal, request))
    return ExpenseRead.model_validate(row)


@router.post("/expenses/{expense_id}/void", response_model=ExpenseRead)
async def void_expense(
    expense_id: uuid.UUID, principal: CurrentPrincipal, request: Request, db: DbSession
) -> ExpenseRead:
    row = await service.void_expense(db, principal, expense_id, audit_actor(principal, request))
    return ExpenseRead.model_validate(row)
