"""Wire format of the sync protocol. See docs/SYNC_PROTOCOL.md."""

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated, Any

from pydantic import Field

from app.modules.cash_management.models import CashMovementType
from app.modules.pricing.models import TaxKind
from app.modules.sales.calculation import DiscountKind
from app.shared.schemas import ResponseSchema, Schema

Money = Annotated[Decimal, Field(max_digits=14, decimal_places=2)]
PositiveMoney = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=2)]
NonNegMoney = Annotated[Decimal, Field(ge=0, max_digits=14, decimal_places=2)]
Qty = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=3)]
Factor = Annotated[Decimal, Field(gt=0, max_digits=14, decimal_places=6)]
TaxRatePct = Annotated[Decimal, Field(ge=0, lt=100, max_digits=6, decimal_places=3)]

# --- Push ----------------------------------------------------------------------------------


class OperationIn(Schema):
    operation_id: uuid.UUID
    entity_type: str = Field(max_length=32)
    entity_id: uuid.UUID
    operation: str = Field(max_length=48)
    created_at: datetime
    payload: dict[str, Any]


class PushRequest(Schema):
    operations: list[OperationIn] = Field(max_length=100)
    # Device status, reported with every push.
    pending_count: int | None = Field(default=None, ge=0)
    app_version: str | None = Field(default=None, max_length=32)
    device_time: datetime | None = None


class OpStatus(StrEnum):
    APPLIED = "APPLIED"  # processed now
    DUPLICATE = "DUPLICATE"  # already processed earlier: success
    DEFERRED = "DEFERRED"  # a dependency is missing: retry later, not a failure
    REJECTED = "REJECTED"  # invalid: will never succeed as sent
    CONFLICT = "CONFLICT"  # same entity already exists with different content
    RETRY = "RETRY"  # transient server error: retry with backoff


class OpError(ResponseSchema):
    code: str
    message: str
    details: dict[str, Any] = {}


class OperationResult(ResponseSchema):
    operation_id: uuid.UUID
    status: OpStatus
    error: OpError | None = None
    result: dict[str, Any] | None = None


class PushResponse(ResponseSchema):
    results: list[OperationResult]
    server_time: datetime


# --- Operation payloads ---------------------------------------------------------------------


class DiscountIn(Schema):
    kind: DiscountKind
    value: NonNegMoney
    reason: str | None = Field(default=None, max_length=200)
    authorized_by_id: uuid.UUID | None = None


class SaleItemIn(Schema):
    id: uuid.UUID
    line_no: int = Field(ge=1)
    variant_id: uuid.UUID
    product_unit_id: uuid.UUID
    unit_code: str = Field(max_length=16)
    unit_factor: Factor
    product_name: str = Field(max_length=200)
    variant_name: str | None = Field(default=None, max_length=200)
    sku: str = Field(max_length=64)
    barcode: str | None = Field(default=None, max_length=64)
    quantity: Qty
    unit_price: NonNegMoney
    original_unit_price: NonNegMoney | None = None
    price_overridden_by_id: uuid.UUID | None = None
    discount: DiscountIn | None = None
    promotion_id: uuid.UUID | None = None
    tax_rate_id: uuid.UUID | None = None
    tax_rate: TaxRatePct
    tax_kind: TaxKind
    # Values computed by the terminal (verified by the server).
    gross: Money
    line_discount: Money
    order_discount_share: Money
    net: Money
    tax_amount: Money
    total: Money


class PaymentIn(Schema):
    id: uuid.UUID
    payment_method_id: uuid.UUID
    amount: PositiveMoney
    tendered: NonNegMoney | None = None
    reference_no: str | None = Field(default=None, max_length=100)


class SaleTotalsIn(Schema):
    gross_total: Money
    line_discount_total: Money
    order_discount_total: Money
    discount_total: Money
    tax_total: Money
    total: NonNegMoney
    paid_total: Money
    change_total: Money
    vatable_sales: Money
    vat_amount: Money
    exempt_sales: Money
    zero_rated_sales: Money


class SaleCompletePayload(Schema):
    schema_version: int = 1
    id: uuid.UUID
    receipt_number: str = Field(min_length=1, max_length=40)
    cash_session_id: uuid.UUID | None = None
    cashier_id: uuid.UUID
    customer_id: uuid.UUID | None = None
    price_level_id: uuid.UUID
    stock_location_id: uuid.UUID | None = None
    prices_include_tax: bool
    occurred_at: datetime
    order_discount: DiscountIn | None = None
    notes: str | None = Field(default=None, max_length=500)
    items: list[SaleItemIn] = Field(min_length=1, max_length=500)
    payments: list[PaymentIn] = Field(min_length=1, max_length=10)
    totals: SaleTotalsIn


class CashSessionOpenPayload(Schema):
    id: uuid.UUID
    opened_by_id: uuid.UUID
    opened_at: datetime
    opening_float: NonNegMoney


class CashSessionClosePayload(Schema):
    id: uuid.UUID
    closed_by_id: uuid.UUID
    closed_at: datetime
    counted_cash: NonNegMoney
    expected_cash: Money
    over_short: Money
    note: str | None = Field(default=None, max_length=500)


class CashMovementPayload(Schema):
    id: uuid.UUID
    cash_session_id: uuid.UUID
    movement_type: CashMovementType
    amount: PositiveMoney
    reason: str | None = Field(default=None, max_length=300)
    user_id: uuid.UUID
    authorized_by_id: uuid.UUID | None = None
    occurred_at: datetime


class CustomerUpsertPayload(Schema):
    id: uuid.UUID
    user_id: uuid.UUID
    name: str = Field(min_length=1, max_length=200)
    code: str | None = Field(default=None, max_length=32)
    phone: str | None = Field(default=None, max_length=50)
    email: str | None = Field(default=None, max_length=254)
    price_level_id: uuid.UUID | None = None
    notes: str | None = Field(default=None, max_length=5000)


class SaleVoidPayload(Schema):
    id: uuid.UUID  # the sale
    voided_by_id: uuid.UUID
    authorized_by_id: uuid.UUID | None = None
    reason: str = Field(min_length=3, max_length=300)
    occurred_at: datetime


class ReturnItemPayload(Schema):
    id: uuid.UUID
    sale_item_id: uuid.UUID
    quantity: Qty
    restock: bool = True


class RefundPayload(Schema):
    id: uuid.UUID
    payment_method_id: uuid.UUID
    amount: PositiveMoney
    reference_no: str | None = Field(default=None, max_length=100)


class ReturnCreatePayload(Schema):
    id: uuid.UUID
    sale_id: uuid.UUID
    return_number: str = Field(min_length=1, max_length=40)
    cash_session_id: uuid.UUID | None = None
    cashier_id: uuid.UUID
    authorized_by_id: uuid.UUID | None = None
    reason: str = Field(min_length=3, max_length=300)
    occurred_at: datetime
    items: list[ReturnItemPayload] = Field(min_length=1, max_length=500)
    refunds: list[RefundPayload] = Field(min_length=1, max_length=10)


# --- Pull ----------------------------------------------------------------------------------


class StaffRead(ResponseSchema):
    """Offline login record. See docs/SECURITY.md#offline-authentication."""

    id: uuid.UUID
    username: str
    full_name: str
    is_active: bool
    can_use_pos: bool
    permissions: list[str]
    pin_offline_salt: str | None
    pin_offline_verifier: str | None
    pin_offline_iterations: int | None
    pin_updated_at: datetime | None


class PullResponse(ResponseSchema):
    changes: dict[str, list[dict[str, Any]]]
    staff: list[StaffRead] | None = Field(
        default=None, description="Full staff snapshot; sent on the first page of each pass"
    )
    counts: dict[str, int] | None = Field(
        default=None, description="Rows per table in this pass (first page of a full download)"
    )
    next_cursor: str
    has_more: bool
    server_time: datetime


class SyncContext(ResponseSchema):
    device_id: uuid.UUID
    terminal_code: str
    company: dict[str, Any]
    branch: dict[str, Any]
    stock_locations: list[dict[str, Any]]
    default_stock_location_id: uuid.UUID
    receipt_prefix: str
    last_receipt_seq: int
    server_time: datetime
