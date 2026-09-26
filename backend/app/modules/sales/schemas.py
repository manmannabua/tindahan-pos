import uuid
from datetime import datetime
from decimal import Decimal

from app.shared.schemas import ResponseSchema


class SaleItemRead(ResponseSchema):
    id: uuid.UUID
    line_no: int
    product_id: uuid.UUID
    variant_id: uuid.UUID
    product_name: str
    variant_name: str | None
    sku: str
    barcode: str | None
    unit_code: str
    quantity: Decimal
    base_quantity: Decimal
    unit_price: Decimal
    gross: Decimal
    line_discount: Decimal
    order_discount_share: Decimal
    net: Decimal
    tax_rate: Decimal
    tax_kind: str
    tax_amount: Decimal
    total: Decimal
    statutory: bool
    vat_exemption: Decimal
    statutory_discount: Decimal


class PaymentRead(ResponseSchema):
    id: uuid.UUID
    payment_method_id: uuid.UUID
    method_kind: str
    amount: Decimal
    tendered: Decimal | None
    change_amount: Decimal
    reference_no: str | None
    status: str


class SaleSummary(ResponseSchema):
    id: uuid.UUID
    receipt_number: str
    branch_id: uuid.UUID
    device_id: uuid.UUID
    cash_session_id: uuid.UUID | None
    cashier_id: uuid.UUID
    customer_id: uuid.UUID | None
    status: str
    total: Decimal
    discount_total: Decimal
    tax_total: Decimal
    paid_total: Decimal
    change_total: Decimal
    totals_mismatch: bool
    occurred_at: datetime
    received_at: datetime


class SaleDetail(SaleSummary):
    gross_total: Decimal
    line_discount_total: Decimal
    order_discount_total: Decimal
    vatable_sales: Decimal
    vat_amount: Decimal
    exempt_sales: Decimal
    zero_rated_sales: Decimal
    statutory_kind: str | None
    statutory_id_number: str | None
    statutory_holder_name: str | None
    statutory_holder_tin: str | None
    vat_exemption_total: Decimal
    statutory_discount_total: Decimal
    order_discount_kind: str | None
    order_discount_value: Decimal | None
    order_discount_reason: str | None
    notes: str | None
    voided_at: datetime | None
    void_reason: str | None
    items: list[SaleItemRead]
    payments: list[PaymentRead]
