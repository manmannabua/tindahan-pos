"""Voids, returns, refunds and offline customers (Phase 7)."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid_utils.compat import uuid7

from app.modules.inventory.models import InventoryBalance
from app.modules.review_flags.models import ReviewFlag
from app.modules.sales.models import Sale
from tests.helpers import signup
from tests.sync_helpers import Terminal, make_terminal, stocked_item


def _id() -> str:
    return str(uuid7())


async def _balance(db: AsyncSession, variant_id: str) -> Decimal:
    value = await db.scalar(
        select(InventoryBalance.quantity).where(InventoryBalance.variant_id == variant_id)
    )
    return value if value is not None else Decimal(0)


def _return_op(
    terminal: Terminal, sale_op: dict[str, Any], quantity: str, refund: str, *, restock: bool = True
) -> dict[str, Any]:
    item = sale_op["payload"]["items"][0]
    return terminal.op(
        "return.create",
        "return",
        {
            "id": _id(),
            "sale_id": sale_op["entity_id"],
            "return_number": f"{terminal.prefix}R{terminal.receipt_seq:06d}",
            "cash_session_id": terminal.session_id,
            "cashier_id": terminal.cashier_id,
            "reason": "Customer changed mind",
            "occurred_at": datetime.now(UTC).isoformat(),
            "items": [
                {"id": _id(), "sale_item_id": item["id"], "quantity": quantity, "restock": restock}
            ],
            "refunds": [
                {
                    "id": _id(),
                    "payment_method_id": terminal.payment_methods["CASH"],
                    "amount": refund,
                }
            ],
        },
    )


async def test_offline_void_restores_stock_and_cash(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant, stock="10", price="25.00")
    terminal = await make_terminal(client, tenant)
    open_op = terminal.open_session("1000.00")
    sale = terminal.sale([(item, "4")])
    void = terminal.op(
        "sale.void",
        "sale",
        {
            "id": sale["entity_id"],
            "voided_by_id": terminal.cashier_id,
            "reason": "Rang up wrong item",
            "occurred_at": datetime.now(UTC).isoformat(),
        },
    )
    close = terminal.close_session(counted="1000.00", expected="1000.00")
    results = await terminal.push([open_op, sale, void, close])
    assert [r["status"] for r in results] == ["APPLIED"] * 4

    stored = await db.get(Sale, sale["entity_id"])
    assert stored is not None and stored.status == "VOIDED"
    assert await _balance(db, item.variant_id) == Decimal(10)
    # Voided sale money is not expected in the drawer.
    assert results[3]["result"]["server_expected_cash"] == "1000.00"
    # The cashier role lacks sales.void and no manager authorized it → flagged.
    flag = await db.scalar(
        select(ReviewFlag).where(
            ReviewFlag.company_id == tenant.company_id, ReviewFlag.entity_id == sale["entity_id"]
        )
    )
    assert flag is not None and flag.flag_type == "USER_NOT_AUTHORIZED"


async def test_void_after_shift_close_is_rejected(client: AsyncClient) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    terminal = await make_terminal(client, tenant)
    open_op = terminal.open_session()
    sale = terminal.sale([(item, "1")])
    close = terminal.close_session(counted="1025.00", expected="1025.00")
    await terminal.push([open_op, sale, close])
    late = terminal.op(
        "sale.void",
        "sale",
        {
            "id": sale["entity_id"],
            "voided_by_id": terminal.cashier_id,
            "reason": "Too late",
            "occurred_at": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
        },
    )
    result = (await terminal.push([late]))[0]
    assert result["status"] == "REJECTED"
    assert result["error"]["code"] == "sale.session_closed"


async def test_partial_returns_pro_rata_and_over_return(
    client: AsyncClient, db: AsyncSession
) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant, stock="10", price="33.33")
    terminal = await make_terminal(client, tenant)
    open_op = terminal.open_session("500.00")
    sale = terminal.sale([(item, "3")])  # 99.99
    await terminal.push([open_op, sale])

    first = _return_op(terminal, sale, "1", "33.33")
    assert (await terminal.push([first]))[0]["status"] == "APPLIED"
    # Last two units: refund exactly what remains (99.99 - 33.33 = 66.66), no rounding drift.
    wrong = _return_op(terminal, sale, "2", "66.67")
    result = (await terminal.push([wrong]))[0]
    assert result["status"] == "REJECTED" and result["error"]["code"] == "return.refund_mismatch"
    second = _return_op(terminal, sale, "2", "66.66", restock=False)
    assert (await terminal.push([second]))[0]["status"] == "APPLIED"
    over = _return_op(terminal, sale, "1", "33.33")
    result = (await terminal.push([over]))[0]
    assert result["status"] == "REJECTED" and result["error"]["code"] == "return.over_return"

    # 10 - 3 sold + 1 restocked (the other two were not restockable).
    assert await _balance(db, item.variant_id) == Decimal(8)
    close = terminal.close_session(counted="400.00", expected="400.00")
    close["payload"]["id"] = open_op["payload"]["id"]
    closed = (await terminal.push([close]))[0]
    # 500 float + 99.99 cash sale - 99.99 cash refunds
    assert closed["result"]["server_expected_cash"] == "500.00"


async def test_online_return_and_void_api(client: AsyncClient) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant, stock="10", price="20.00")
    terminal = await make_terminal(client, tenant)
    open_op = terminal.open_session()
    sale_a = terminal.sale([(item, "2")])
    sale_b = terminal.sale([(item, "1")])
    await terminal.push([open_op, sale_a, sale_b])

    detail = (
        await client.get(f"/api/v1/sales/{sale_a['entity_id']}", headers=tenant.headers)
    ).json()
    resp = await client.post(
        "/api/v1/returns",
        json={
            "sale_id": sale_a["entity_id"],
            "reason": "Defective",
            "items": [{"sale_item_id": detail["items"][0]["id"], "quantity": "1"}],
            "refunds": [{"payment_method_id": terminal.payment_methods["CASH"], "amount": "20.00"}],
        },
        headers=tenant.headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["return_number"] == "RET-000001"

    # A sale with returns cannot be voided; one without can.
    blocked = await client.post(
        f"/api/v1/sales/{sale_a['entity_id']}/void", json={"reason": "oops"}, headers=tenant.headers
    )
    assert blocked.status_code == 422
    voided = await client.post(
        f"/api/v1/sales/{sale_b['entity_id']}/void",
        json={"reason": "Wrong item"},
        headers=tenant.headers,
    )
    assert voided.status_code == 200 and voided.json()["status"] == "VOIDED"


async def test_customer_created_offline_before_its_sale(
    client: AsyncClient, db: AsyncSession
) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    terminal = await make_terminal(client, tenant)
    customer_id = _id()
    customer = terminal.op(
        "customer.upsert",
        "customer",
        {
            "id": customer_id,
            "user_id": terminal.cashier_id,
            "name": "Juan Dela Cruz",
            "phone": "0917 123 4567",
        },
    )
    open_op = terminal.open_session()
    sale = terminal.sale([(item, "1")])
    sale["payload"]["customer_id"] = customer_id

    # Sale arrives before the customer → deferred, then applied after the customer syncs.
    first = await terminal.push([open_op, sale])
    assert [r["status"] for r in first] == ["APPLIED", "DEFERRED"]
    second = await terminal.push([customer, sale])
    assert [r["status"] for r in second] == ["APPLIED", "APPLIED"]

    found = (
        await client.get("/api/v1/customers", params={"q": "09171234567"}, headers=tenant.headers)
    ).json()
    assert [c["name"] for c in found["items"]] == ["Juan Dela Cruz"]

    # Another terminal creates the same person again → kept, but flagged for merging.
    duplicate = terminal.op(
        "customer.upsert",
        "customer",
        {"id": _id(), "user_id": terminal.cashier_id, "name": "Juan D.", "phone": "09171234567"},
    )
    assert (await terminal.push([duplicate]))[0]["status"] == "APPLIED"
    flag = await db.scalar(
        select(ReviewFlag).where(
            ReviewFlag.company_id == tenant.company_id, ReviewFlag.flag_type == "DUPLICATE_CUSTOMER"
        )
    )
    assert flag is not None


async def test_promotion_crud_and_pull_shape(client: AsyncClient) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    resp = await client.post(
        "/api/v1/promotions",
        json={
            "name": "Buy 2 get 1",
            "kind": "BUY_X_GET_Y",
            "buy_quantity": "2",
            "get_quantity": "1",
            "targets": [{"type": "VARIANT", "id": item.variant_id}],
            "days_of_week": [6, 7, 6],
            "start_time": "16:00:00",
            "end_time": "19:00:00",
        },
        headers=tenant.headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["days_of_week"] == [6, 7]
    bad = await client.post(
        "/api/v1/promotions",
        json={"name": "Bad", "kind": "PERCENT_OFF", "value": "120", "targets": [{"type": "ALL"}]},
        headers=tenant.headers,
    )
    assert bad.status_code == 422
    unknown = await client.post(
        "/api/v1/promotions",
        json={
            "name": "Ghost",
            "kind": "PERCENT_OFF",
            "value": "10",
            "targets": [{"type": "CATEGORY", "id": _id()}],
        },
        headers=tenant.headers,
    )
    assert unknown.status_code == 404
