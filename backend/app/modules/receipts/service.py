"""Reading the receipt journal (written only by terminals through sync)."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.principal import Principal
from app.modules.devices.models import Device
from app.modules.receipts.models import Receipt, ReceiptKind, ReceiptPrint
from app.modules.receipts.schemas import (
    SalesReceiptPrintRead,
    SalesReceiptRead,
    SalesReceiptSummary,
)
from app.modules.users.permissions import P
from app.shared.exceptions import NotFoundError


def _summary_query(principal: Principal) -> Select[Any]:
    prints = (
        select(
            ReceiptPrint.receipt_id,
            func.count().label("print_count"),
            func.max(ReceiptPrint.printed_at).label("last_printed_at"),
        )
        .group_by(ReceiptPrint.receipt_id)
        .subquery()
    )
    last_method = (
        select(ReceiptPrint.method)
        .where(ReceiptPrint.receipt_id == Receipt.id)
        .order_by(ReceiptPrint.printed_at.desc())
        .limit(1)
        .scalar_subquery()
    )
    stmt = (
        select(
            Receipt,
            Device.terminal_code,
            func.coalesce(prints.c.print_count, 0).label("print_count"),
            prints.c.last_printed_at,
            last_method.label("last_print_method"),
        )
        .join(Device, Device.id == Receipt.device_id)
        .outerjoin(prints, prints.c.receipt_id == Receipt.id)
        .where(Receipt.company_id == principal.company_id)
    )
    scope = principal.branch_scope(P.SALES_VIEW)
    if scope is not None:
        stmt = stmt.where(Receipt.branch_id.in_(scope))
    return stmt


def _summary(row: Any) -> dict[str, Any]:
    receipt: Receipt = row[0]
    return {
        **{c: getattr(receipt, c) for c in SalesReceiptSummary.model_fields if hasattr(receipt, c)},
        "terminal_code": row.terminal_code,
        "print_count": row.print_count,
        "last_printed_at": row.last_printed_at,
        "last_print_method": row.last_print_method,
    }


async def list_receipts(
    db: AsyncSession,
    principal: Principal,
    *,
    q: str | None,
    kind: ReceiptKind | None,
    printed: bool | None,
    branch_id: uuid.UUID | None,
    device_id: uuid.UUID | None,
    sale_id: uuid.UUID | None,
    issued_from: datetime | None,
    issued_to: datetime | None,
    limit: int,
    offset: int,
) -> tuple[list[SalesReceiptSummary], int]:
    stmt = _summary_query(principal)
    if q and q.strip():
        stmt = stmt.where(Receipt.number.ilike(f"%{q.strip()}%"))
    for column, value in (
        (Receipt.kind, kind),
        (Receipt.branch_id, branch_id),
        (Receipt.device_id, device_id),
        (Receipt.sale_id, sale_id),
    ):
        if value is not None:
            stmt = stmt.where(column == value)
    if printed is not None:
        count = func.coalesce(stmt.selected_columns.print_count, 0)
        stmt = stmt.where(count > 0 if printed else count == 0)
    if issued_from:
        stmt = stmt.where(Receipt.issued_at >= issued_from)
    if issued_to:
        stmt = stmt.where(Receipt.issued_at < issued_to)
    total = await db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = await db.execute(
        stmt.order_by(Receipt.issued_at.desc(), Receipt.id.desc()).limit(limit).offset(offset)
    )
    return [SalesReceiptSummary.model_validate(_summary(r)) for r in rows], total


async def get_receipt(
    db: AsyncSession, principal: Principal, receipt_id: uuid.UUID
) -> SalesReceiptRead:
    row = (await db.execute(_summary_query(principal).where(Receipt.id == receipt_id))).first()
    if row is None:
        raise NotFoundError("Receipt not found", code="receipt.not_found")
    receipt: Receipt = row[0]
    prints = [
        SalesReceiptPrintRead(
            id=p.id,
            printed_at=p.printed_at,
            method=p.method,
            is_reprint=p.is_reprint,
            fallback_reason=p.fallback_reason,
            terminal_code=code,
        )
        for p, code in (
            await db.execute(
                select(ReceiptPrint, Device.terminal_code)
                .join(Device, Device.id == ReceiptPrint.device_id)
                .where(ReceiptPrint.receipt_id == receipt.id)
                .order_by(ReceiptPrint.printed_at)
            )
        ).all()
    ]
    return SalesReceiptRead.model_validate(
        {**_summary(row), "width": receipt.width, "lines": receipt.lines, "prints": prints}
    )
