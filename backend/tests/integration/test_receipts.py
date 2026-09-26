"""Receipt journal: terminals push every issued receipt and every print; admins read it."""

from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession
from uuid_utils.compat import uuid7

from tests.helpers import create_user, login, signup
from tests.sync_helpers import Terminal, make_terminal, stocked_item

LINES = [
    {"kind": "center", "text": "ACME Trading", "bold": True},
    {"kind": "rule"},
    {"kind": "pair", "left": "TOTAL", "right": "₱50.00", "bold": True},
    {"kind": "barcode", "value": "X"},
]


def issue(terminal: Terminal, sale_op: dict[str, Any], **overrides: Any) -> dict[str, Any]:
    sale = sale_op["payload"]
    return terminal.op(
        "receipt.issue",
        "receipt",
        {
            "id": str(uuid7()),
            "kind": "SALE",
            "number": sale["receipt_number"],
            "sale_id": sale["id"],
            "issued_at": sale["occurred_at"],
            "width": 58,
            "lines": LINES,
            "total": sale["totals"]["total"],
            "cashier_name": "Cathy Cashier",
            **overrides,
        },
    )


def printed(
    terminal: Terminal, receipt_id: str, *, method: str = "ESCPOS", reprint: bool = False
) -> dict[str, Any]:
    return terminal.op(
        "receipt.print",
        "receipt_print",
        {
            "id": str(uuid7()),
            "receipt_id": receipt_id,
            "printed_at": datetime.now(UTC).isoformat(),
            "method": method,
            "is_reprint": reprint,
            "fallback_reason": "Printer not paired" if method == "BROWSER" else None,
        },
    )


async def test_journal_records_receipts_printed_or_not(client: AsyncClient) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    terminal = await make_terminal(client, tenant)
    await terminal.push([terminal.open_session()])
    first, second = terminal.sale([(item, "2")]), terminal.sale([(item, "1")])
    r1, r2 = issue(terminal, first), issue(terminal, second)
    ops = [first, second, r1, r2]
    ops += [
        printed(terminal, r1["entity_id"]),
        printed(terminal, r1["entity_id"], method="BROWSER", reprint=True),
    ]
    results = await terminal.push(ops)
    assert [r["status"] for r in results] == ["APPLIED"] * 6

    listing = (await client.get("/api/v1/receipts", headers=tenant.headers)).json()
    assert listing["total"] == 2
    by_number = {r["number"]: r for r in listing["items"]}
    one = by_number[first["payload"]["receipt_number"]]
    assert (one["print_count"], one["last_print_method"]) == (2, "BROWSER")
    assert one["terminal_code"] == "T01" and one["kind"] == "SALE"
    two = by_number[second["payload"]["receipt_number"]]
    assert (two["print_count"], two["last_printed_at"]) == (0, None)

    never = await client.get("/api/v1/receipts", params={"printed": False}, headers=tenant.headers)
    assert [r["number"] for r in never.json()["items"]] == [second["payload"]["receipt_number"]]
    by_sale = await client.get(
        "/api/v1/receipts", params={"sale_id": first["payload"]["id"]}, headers=tenant.headers
    )
    assert [r["id"] for r in by_sale.json()["items"]] == [r1["entity_id"]]

    detail = (
        await client.get(f"/api/v1/receipts/{r1['entity_id']}", headers=tenant.headers)
    ).json()
    assert detail["lines"] == LINES  # stored verbatim
    assert detail["width"] == 58
    assert [(p["method"], p["is_reprint"]) for p in detail["prints"]] == [
        ("ESCPOS", False),
        ("BROWSER", True),
    ]
    assert detail["prints"][1]["fallback_reason"] == "Printer not paired"

    # Re-sending the same operations is idempotent.
    again = await terminal.push(ops)
    assert {r["status"] for r in again} == {"DUPLICATE"}


async def test_dependencies_are_deferred_until_they_arrive(client: AsyncClient) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    terminal = await make_terminal(client, tenant)
    await terminal.push([terminal.open_session()])
    sale = terminal.sale([(item, "1")])
    receipt = issue(terminal, sale)
    print_op = printed(terminal, receipt["entity_id"])

    results = await terminal.push([print_op, receipt])
    assert [r["status"] for r in results] == ["DEFERRED", "DEFERRED"]
    results = await terminal.push([sale, receipt, print_op])
    assert [r["status"] for r in results] == ["APPLIED"] * 3


async def test_rejects_mismatched_or_foreign_receipts(client: AsyncClient) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    till = await make_terminal(client, tenant)
    other_till = await make_terminal(client, tenant, terminal_code="T02")
    await till.push([till.open_session()])
    sale = till.sale([(item, "1")])
    assert (await till.push([sale]))[0]["status"] == "APPLIED"

    wrong_number = (await till.push([issue(till, sale, number="NOPE-1")]))[0]
    assert (wrong_number["status"], wrong_number["error"]["code"]) == (
        "REJECTED",
        "sync.receipt_mismatch",
    )
    from_other_terminal = (await other_till.push([issue(other_till, sale)]))[0]
    assert from_other_terminal["error"]["code"] == "sync.foreign_receipt"
    no_sale = (await till.push([issue(till, sale, sale_id=None)]))[0]
    assert no_sale["error"]["code"] == "sync.invalid_payload"
    bad_line = (await till.push([issue(till, sale, lines=[{"kind": "html", "text": "<b>"}])]))[0]
    assert bad_line["error"]["code"] == "sync.invalid_payload"

    assert (await till.push([issue(till, sale)]))[0]["status"] == "APPLIED"
    duplicate_number = (await till.push([issue(till, sale)]))[0]
    assert duplicate_number["error"]["code"] == "sync.receipt_exists"


async def test_journal_is_append_only(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant)
    terminal = await make_terminal(client, tenant)
    await terminal.push([terminal.open_session()])
    sale = terminal.sale([(item, "1")])
    receipt = issue(terminal, sale)
    await terminal.push([sale, receipt])
    with pytest.raises(DBAPIError, match="append-only"):
        await db.execute(
            text("UPDATE receipts SET total = 0 WHERE id = :id"), {"id": receipt["entity_id"]}
        )
    await db.rollback()


async def test_cashiers_cannot_read_the_journal(client: AsyncClient) -> None:
    tenant = await signup(client)
    await create_user(client, tenant.headers, username="cashier", role_code="CASHIER")
    token = await login(client, "cashier@example.com")
    resp = await client.get("/api/v1/receipts", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403
