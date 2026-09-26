"""Sales queries for the admin portal. Sales are *created* only through sync (modules/sync)."""

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.auth.principal import Principal
from app.modules.sales.models import Sale
from app.modules.users.permissions import P
from app.shared.exceptions import NotFoundError


async def list_sales(
    db: AsyncSession,
    principal: Principal,
    *,
    branch_id: uuid.UUID | None,
    device_id: uuid.UUID | None,
    cashier_id: uuid.UUID | None,
    cash_session_id: uuid.UUID | None,
    receipt_number: str | None,
    occurred_from: datetime | None,
    occurred_to: datetime | None,
    limit: int,
    offset: int,
) -> tuple[list[Sale], int]:
    stmt = select(Sale).where(Sale.company_id == principal.company_id)
    scope = principal.branch_scope(P.SALES_VIEW)
    if scope is not None:
        stmt = stmt.where(Sale.branch_id.in_(scope))
    filters = {
        Sale.branch_id: branch_id,
        Sale.device_id: device_id,
        Sale.cashier_id: cashier_id,
        Sale.cash_session_id: cash_session_id,
        Sale.receipt_number: receipt_number,
    }
    for column, value in filters.items():
        if value is not None:
            stmt = stmt.where(column == value)
    if occurred_from:
        stmt = stmt.where(Sale.occurred_at >= occurred_from)
    if occurred_to:
        stmt = stmt.where(Sale.occurred_at < occurred_to)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.scalars(
        stmt.order_by(Sale.occurred_at.desc(), Sale.id.desc()).limit(limit).offset(offset)
    )
    return list(rows), total


async def get_sale(db: AsyncSession, principal: Principal, sale_id: uuid.UUID) -> Sale:
    sale = await db.scalar(
        select(Sale)
        .where(Sale.company_id == principal.company_id, Sale.id == sale_id)
        .options(selectinload(Sale.items), selectinload(Sale.payments))
    )
    if sale is None or not principal.has(P.SALES_VIEW, sale.branch_id):
        raise NotFoundError("Sale not found", code="sale.not_found")
    return sale
