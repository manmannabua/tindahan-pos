"""Push protocol: exactly-once application of offline operations (docs/SYNC_PROTOCOL.md §3)."""

from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid_utils.compat import uuid7

from app.modules.cash_management.models import CashSession
from app.modules.inventory.models import InventoryBalance, InventoryMovement
from app.modules.payments.models import Payment
from app.modules.review_flags.models import ReviewFlag
from app.modules.sales.models import Sale, SaleItem
from app.modules.sync.models import SyncOperation
from tests.helpers import Tenant, signup
from tests.sync_helpers import make_terminal, stocked_item


async def _count(db: AsyncSession, model: Any, tenant: Tenant, *where: object) -> int:
    """Row count within the test's company (other tests may have committed rows)."""
    stmt = select(func.count()).select_from(model).where(model.company_id == tenant.company_id)
    return int(await db.scalar(stmt.where(*where)) or 0)


async def test_offline_day_syncs_exactly_once(client: AsyncClient, db: AsyncSession) -> None:
    """Open a shift, make 20 sales, close the shift, push — then push everything again."""
    tenant = await signup(client)
    item = await stocked_item(client, tenant, stock="100", price="25.00")
    terminal = await make_terminal(client, tenant)

    ops = [terminal.open_session("1000.00")]
    ops += [terminal.sale([(item, "2")], tendered="100.00") for _ in range(20)]
    # 20 sales x 50.00 cash; drawer expected 1000 + 1000 = 2000.00
    ops.append(terminal.close_session(counted="1999.00", expected="2000.00"))

    results = await terminal.push(ops, pending_count=0, app_version="0.1.0")
    assert [r["status"] for r in results] == ["APPLIED"] * 22

    assert await _count(db, Sale, tenant, Sale.device_id == terminal.device["id"]) == 20
    assert await _count(db, SaleItem, tenant) == 20
    assert await _count(db, Payment, tenant) == 20
    assert (
        await _count(db, InventoryMovement, tenant, InventoryMovement.movement_type == "SALE") == 20
    )
    balance = await db.scalar(
        select(InventoryBalance.quantity).where(InventoryBalance.variant_id == item.variant_id)
    )
    assert balance == Decimal("60")  # 100 - 20 x 2
    session = await db.get(CashSession, terminal.session_id)
    assert session is not None and session.status == "CLOSED"
    assert session.server_expected_cash == Decimal("2000.00")
    assert session.over_short == Decimal("-1.00")

    # The connection dropped before the terminal saw the acknowledgment: it resends everything.
    again = await terminal.push(ops)
    assert [r["status"] for r in again] == ["DUPLICATE"] * 22
    assert await _count(db, Sale, tenant) == 20
    assert await _count(db, Payment, tenant) == 20
    assert (
        await _count(db, InventoryMovement, tenant, InventoryMovement.movement_type == "SALE") == 20
    )
    assert await _count(db, SyncOperation, tenant) == 22

    device = (
        await client.get(f"/api/v1/devices/{terminal.device['id']}", headers=tenant.headers)
    ).json()
    assert device["last_sync_at"] and device["pending_operations"] == 0


async def test_same_sale_new_operation_id(client: AsyncClient, db: AsyncSession) -> None:
    """Outbox rebuilt on the device: same sale, new operation id → still one sale."""
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    terminal = await make_terminal(client, tenant)
    await terminal.push([terminal.open_session()])
    sale_op = terminal.sale([(item, "1")])
    assert (await terminal.push([sale_op]))[0]["status"] == "APPLIED"

    rebuilt = {**sale_op, "operation_id": str(uuid7())}
    assert (await terminal.push([rebuilt]))[0]["status"] == "DUPLICATE"

    tampered = {
        **sale_op,
        "operation_id": str(uuid7()),
        "payload": {**sale_op["payload"], "notes": "changed"},
    }
    result = (await terminal.push([tampered]))[0]
    assert result["status"] == "CONFLICT"
    assert result["error"]["code"] == "sync.payload_mismatch"
    assert await _count(db, Sale, tenant) == 1


async def test_sale_before_its_cash_session_is_deferred(
    client: AsyncClient, db: AsyncSession
) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    terminal = await make_terminal(client, tenant)
    open_op = terminal.open_session()
    sale_op = terminal.sale([(item, "1")])

    first = await terminal.push([sale_op])
    assert first[0]["status"] == "DEFERRED"
    assert first[0]["error"]["code"] == "sync.cash_session_missing"
    assert await _count(db, Sale, tenant) == 0

    second = await terminal.push([open_op, sale_op])
    assert [r["status"] for r in second] == ["APPLIED", "APPLIED"]


async def test_invalid_operation_rejected_and_remembered(
    client: AsyncClient, db: AsyncSession
) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    terminal = await make_terminal(client, tenant)
    await terminal.push([terminal.open_session()])
    bad = terminal.sale([(item, "1")])
    bad["payload"]["items"][0]["variant_id"] = "00000000-0000-7000-8000-000000000000"

    result = (await terminal.push([bad]))[0]
    assert result["status"] == "REJECTED"
    assert result["error"]["code"] == "sync.unknown_variant"
    again = (await terminal.push([bad]))[0]
    assert again["status"] == "REJECTED"
    assert await _count(db, Sale, tenant) == 0

    unknown = terminal.op("sale.explode", "sale", {"id": bad["entity_id"]})
    assert (await terminal.push([unknown]))[0]["status"] == "REJECTED"


async def test_total_mismatch_is_stored_and_flagged(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    terminal = await make_terminal(client, tenant)
    await terminal.push([terminal.open_session()])
    op = terminal.sale([(item, "1")], tamper_total=True)
    assert (await terminal.push([op]))[0]["status"] == "APPLIED"

    sale = await db.get(Sale, op["entity_id"])
    assert sale is not None and sale.totals_mismatch
    assert sale.total == Decimal("26.00")  # what the customer was charged is preserved
    flag = await db.scalar(
        select(ReviewFlag).where(
            ReviewFlag.company_id == tenant.company_id, ReviewFlag.flag_type == "TOTAL_MISMATCH"
        )
    )
    assert flag is not None
    assert any(d["field"] == "total" for d in flag.details["differences"])


async def test_two_offline_terminals_oversell(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant, stock="5")
    a = await make_terminal(client, tenant, terminal_code="T01")
    b = await make_terminal(client, tenant, terminal_code="T02")
    ops_a = [a.open_session(), a.sale([(item, "4")])]
    ops_b = [b.open_session(), b.sale([(item, "3")])]

    assert [r["status"] for r in await a.push(ops_a)] == ["APPLIED", "APPLIED"]
    assert [r["status"] for r in await b.push(ops_b)] == ["APPLIED", "APPLIED"]

    assert await _count(db, Sale, tenant) == 2  # neither legitimate sale was dropped
    balance = await db.scalar(
        select(InventoryBalance.quantity).where(InventoryBalance.variant_id == item.variant_id)
    )
    assert balance == Decimal("-2")
    flag = await db.scalar(
        select(ReviewFlag).where(
            ReviewFlag.company_id == tenant.company_id, ReviewFlag.flag_type == "NEGATIVE_INVENTORY"
        )
    )
    assert flag is not None
    assert flag.details["references"] == [ops_b[1]["entity_id"]]


async def test_split_payment_and_cash_movements(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant, price="67.17")
    terminal = await make_terminal(client, tenant)
    await terminal.push([terminal.open_session("500.00")])

    op = terminal.sale([(item, "1")])
    op["payload"]["payments"] = [
        {
            "id": str(uuid7()),
            "payment_method_id": terminal.payment_methods["GCASH"],
            "amount": "50.00",
            "reference_no": "GC-123",
        },
        {
            "id": str(uuid7()),
            "payment_method_id": terminal.payment_methods["CASH"],
            "amount": "17.17",
            "tendered": "20.00",
        },
    ]
    op["payload"]["totals"]["change_total"] = "2.83"
    assert (await terminal.push([op]))[0]["status"] == "APPLIED"

    pickup = terminal.op(
        "cash_movement.record",
        "cash_movement",
        {
            "id": str(uuid7()),
            "cash_session_id": terminal.session_id,
            "movement_type": "PICKUP",
            "amount": "100.00",
            "reason": "Safe drop",
            "user_id": terminal.cashier_id,
            "occurred_at": op["created_at"],
        },
    )
    close = terminal.close_session(counted="417.17", expected="417.17")
    results = await terminal.push([pickup, close])
    assert [r["status"] for r in results] == ["APPLIED", "APPLIED"]
    # 500 float + 17.17 cash - 100 pickup; GCash does not go into the drawer.
    assert results[1]["result"]["server_expected_cash"] == "417.17"

    flags = list(
        await db.scalars(select(ReviewFlag).where(ReviewFlag.company_id == tenant.company_id))
    )
    # The cashier role lacks cash.manage, so the unapproved pickup is flagged — nothing else is.
    assert [f.flag_type for f in flags] == ["USER_NOT_AUTHORIZED"]
    payments = list(
        await db.scalars(
            select(Payment).where(Payment.company_id == tenant.company_id).order_by(Payment.amount)
        )
    )
    assert [(p.method_kind, p.change_amount) for p in payments] == [
        ("CASH", Decimal("2.83")),
        ("EWALLET", Decimal("0.00")),
    ]


async def test_deactivated_cashier_sale_is_kept_and_flagged(
    client: AsyncClient, db: AsyncSession
) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    terminal = await make_terminal(client, tenant)
    await terminal.push([terminal.open_session()])
    # Cashier was deactivated centrally while the terminal was offline.
    await client.patch(
        f"/api/v1/users/{terminal.cashier_id}", json={"is_active": False}, headers=tenant.headers
    )
    op = terminal.sale([(item, "1")])
    assert (await terminal.push([op]))[0]["status"] == "APPLIED"
    flag = await db.scalar(
        select(ReviewFlag).where(
            ReviewFlag.company_id == tenant.company_id, ReviewFlag.entity_id == op["entity_id"]
        )
    )
    assert flag is not None and flag.flag_type == "USER_NOT_AUTHORIZED"


async def test_receipt_numbering_continues_for_replacement_terminal(client: AsyncClient) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    terminal = await make_terminal(client, tenant, terminal_code="T01")
    await terminal.push(
        [terminal.open_session()] + [terminal.sale([(item, "1")]) for _ in range(3)]
    )
    await client.post(f"/api/v1/devices/{terminal.device['id']}/revoke", headers=tenant.headers)

    replacement = await make_terminal(client, tenant, terminal_code="T01")
    assert replacement.prefix == "MAIN-T01-"
    assert replacement.receipt_seq == 3


async def test_revoked_device_cannot_push(client: AsyncClient) -> None:
    tenant = await signup(client)
    terminal = await make_terminal(client, tenant)
    await client.post(f"/api/v1/devices/{terminal.device['id']}/revoke", headers=tenant.headers)
    resp = await client.post(
        "/api/v1/sync/push",
        json={"operations": [terminal.open_session()]},
        headers=terminal.headers,
    )
    assert resp.status_code == 401


async def test_admin_sales_endpoints(client: AsyncClient) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    terminal = await make_terminal(client, tenant)
    ops = [terminal.open_session(), terminal.sale([(item, "3")], tendered="100.00")]
    await terminal.push(ops)

    page = (
        await client.get(
            "/api/v1/sales", params={"device_id": terminal.device["id"]}, headers=tenant.headers
        )
    ).json()
    assert page["total"] == 1
    detail = (
        await client.get(f"/api/v1/sales/{page['items'][0]['id']}", headers=tenant.headers)
    ).json()
    assert detail["receipt_number"] == "MAIN-T01-000001"
    assert Decimal(detail["total"]) == Decimal("75.00")
    assert Decimal(detail["change_total"]) == Decimal("25.00")
    assert [i["quantity"] for i in detail["items"]] == ["3.000"]
    assert detail["payments"][0]["method_kind"] == "CASH"
