"""A scripted POS terminal for sync tests: builds outbox operations like the real client."""

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from uuid_utils.compat import uuid7

from app.modules.sales.calculation import LineInput, calculate_sale
from tests.catalog_helpers import create_product, default_location, ref_ids
from tests.helpers import Tenant, auth, create_user, device_token, register_device


@dataclass
class Item:
    variant_id: str
    product_unit_id: str
    unit_price: Decimal
    name: str
    sku: str


@dataclass
class Terminal:
    client: AsyncClient
    tenant: Tenant
    device: dict[str, Any]
    token: str
    cashier_id: str
    refs: dict[str, str]
    payment_methods: dict[str, str]
    receipt_seq: int = 0
    session_id: str | None = None
    prefix: str = ""
    sent: list[dict[str, Any]] = field(default_factory=list)

    @property
    def headers(self) -> dict[str, str]:
        return auth(self.token)

    def op(self, operation: str, entity_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "operation_id": str(uuid7()),
            "entity_type": entity_type,
            "entity_id": payload["id"],
            "operation": operation,
            "created_at": datetime.now(UTC).isoformat(),
            "payload": payload,
        }

    def open_session(self, opening_float: str = "1000.00") -> dict[str, Any]:
        self.session_id = str(uuid7())
        return self.op(
            "cash_session.open",
            "cash_session",
            {
                "id": self.session_id,
                "opened_by_id": self.cashier_id,
                "opened_at": datetime.now(UTC).isoformat(),
                "opening_float": opening_float,
            },
        )

    def close_session(self, counted: str, expected: str) -> dict[str, Any]:
        assert self.session_id
        return self.op(
            "cash_session.close",
            "cash_session",
            {
                "id": self.session_id,
                "closed_by_id": self.cashier_id,
                "closed_at": datetime.now(UTC).isoformat(),
                "counted_cash": counted,
                "expected_cash": expected,
                "over_short": str(Decimal(counted) - Decimal(expected)),
            },
        )

    def sale(
        self,
        lines: list[tuple[Item, str]],
        *,
        method: str = "CASH",
        tendered: str | None = None,
        tamper_total: bool = False,
        statutory: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        """`statutory` = senior citizen / PWD holder details; applies to every line."""
        calc = calculate_sale(
            [
                LineInput(Decimal(qty), item.unit_price, Decimal("12"), statutory=bool(statutory))
                for item, qty in lines
            ],
            prices_include_tax=True,
        )
        total = calc.totals.total + (Decimal("1.00") if tamper_total else 0)
        tendered_amount = Decimal(tendered) if tendered else total
        change = tendered_amount - total if method == "CASH" else Decimal(0)
        self.receipt_seq += 1
        sale_id = str(uuid7())
        items = []
        for n, ((item, qty), line) in enumerate(zip(lines, calc.lines, strict=True), start=1):
            items.append(
                {
                    "id": str(uuid7()),
                    "line_no": n,
                    "variant_id": item.variant_id,
                    "product_unit_id": item.product_unit_id,
                    "unit_code": "PC",
                    "unit_factor": "1",
                    "product_name": item.name,
                    "sku": item.sku,
                    "quantity": qty,
                    "unit_price": str(item.unit_price),
                    "tax_rate_id": self.refs["VAT12"],
                    "tax_rate": "12",
                    "tax_kind": "VATABLE",
                    "gross": str(line.gross),
                    "line_discount": str(line.line_discount),
                    "order_discount_share": str(line.order_discount_share),
                    "net": str(line.net),
                    "tax_amount": str(line.tax_amount),
                    "total": str(line.total),
                    "statutory": bool(statutory),
                    "vat_exemption": str(line.vat_exemption),
                    "statutory_discount": str(line.statutory_discount),
                }
            )
        totals = {k: str(getattr(calc.totals, k)) for k in calc.totals.__slots__}
        totals.update(total=str(total), paid_total=str(total), change_total=str(change))
        payment: dict[str, Any] = {
            "id": str(uuid7()),
            "payment_method_id": self.payment_methods[method],
            "amount": str(total),
        }
        if method == "CASH":
            payment["tendered"] = str(tendered_amount)
        extra: dict[str, Any] = {"statutory_discount": statutory} if statutory else {}
        return self.op(
            "sale.complete",
            "sale",
            {
                **extra,
                "id": sale_id,
                "receipt_number": f"{self.prefix}{self.receipt_seq:06d}",
                "cash_session_id": self.session_id,
                "cashier_id": self.cashier_id,
                "price_level_id": self.refs["RETAIL"],
                "prices_include_tax": True,
                "occurred_at": datetime.now(UTC).isoformat(),
                "items": items,
                "payments": [payment],
                "totals": totals,
            },
        )

    async def push(self, ops: list[dict[str, Any]], **extra: Any) -> list[dict[str, Any]]:
        resp = await self.client.post(
            "/api/v1/sync/push", json={"operations": ops, **extra}, headers=self.headers
        )
        assert resp.status_code == 200, resp.text
        return list(resp.json()["results"])


async def make_terminal(
    client: AsyncClient,
    tenant: Tenant,
    *,
    terminal_code: str = "T01",
    cashier: str = "cathy",
) -> Terminal:
    existing = await client.get("/api/v1/users", params={"q": cashier}, headers=tenant.headers)
    items = [u for u in existing.json()["items"] if u["username"] == cashier]
    user = (
        items[0]
        if items
        else await create_user(
            client,
            tenant.headers,
            username=cashier,
            role_code="CASHIER",
            pin="482915",
            email=f"{cashier}@{tenant.email.split('@')[1]}",
        )
    )
    device, key = await register_device(client, tenant.headers, tenant.branch_id, terminal_code)
    token = await device_token(client, device["id"], key)
    methods = (await client.get("/api/v1/payment-methods", headers=tenant.headers)).json()
    context = (await client.get("/api/v1/sync/context", headers=auth(token))).json()
    return Terminal(
        client=client,
        tenant=tenant,
        device=device,
        token=token,
        cashier_id=user["id"],
        refs=await ref_ids(client, tenant.headers),
        payment_methods={m["code"]: m["id"] for m in methods},
        prefix=context["receipt_prefix"],
        receipt_seq=context["last_receipt_seq"],
    )


async def stocked_item(
    client: AsyncClient,
    tenant: Tenant,
    *,
    stock: str = "100",
    price: str = "25.00",
    name: str = "Coke 1.5L",
    cost: str = "60.0000",
) -> Item:
    product = await create_product(
        client, tenant.headers, name=name, price=price, barcode=None, cost=cost
    )
    variant = product["variants"][0]
    location = await default_location(client, tenant.headers, tenant.branch_id)
    if Decimal(stock) > 0:
        resp = await client.post(
            "/api/v1/inventory/initial-stock",
            json={
                "stock_location_id": location,
                "lines": [{"variant_id": variant["id"], "quantity": stock}],
            },
            headers=tenant.headers,
        )
        assert resp.status_code == 201, resp.text
    base_unit = next(u for u in product["units"] if u["is_base"])
    return Item(
        variant_id=variant["id"],
        product_unit_id=base_unit["id"],
        unit_price=Decimal(price),
        name=name,
        sku=variant["sku"],
    )


def new_id() -> str:
    return str(uuid.uuid4())
