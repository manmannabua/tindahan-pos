import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import Field

from app.modules.receipts.models import PrintMethod, ReceiptKind
from app.shared.schemas import ResponseSchema


class SalesReceiptSummary(ResponseSchema):
    id: uuid.UUID
    kind: ReceiptKind
    number: str
    sale_id: uuid.UUID | None
    return_id: uuid.UUID | None
    branch_id: uuid.UUID
    device_id: uuid.UUID
    terminal_code: str
    issued_at: datetime
    total: Decimal
    cashier_name: str
    reconstructed: bool
    print_count: int = Field(description="0 = never printed (virtual only)")
    last_printed_at: datetime | None
    last_print_method: PrintMethod | None


class SalesReceiptPrintRead(ResponseSchema):
    id: uuid.UUID
    printed_at: datetime
    method: PrintMethod
    is_reprint: bool
    fallback_reason: str | None
    terminal_code: str


class SalesReceiptRead(SalesReceiptSummary):
    width: int
    lines: list[dict[str, Any]] = Field(description="ReceiptLine[] exactly as issued")
    prints: list[SalesReceiptPrintRead]
