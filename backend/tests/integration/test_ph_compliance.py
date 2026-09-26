"""Philippine specifics: senior citizen / PWD discount and BIR-style readings."""

import uuid
from datetime import UTC, datetime
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.review_flags.models import ReviewFlag
from app.modules.sales.models import Sale
from tests.helpers import auth, signup
from tests.sync_helpers import make_terminal, stocked_item

SENIOR = {"kind": "SENIOR", "id_number": "OSCA-12345", "holder_name": "Lola Nena"}


async def _make_eligible(client: AsyncClient, headers: dict[str, str], variant_id: str) -> None:
    rows = (await client.get("/api/v1/products", headers=headers)).json()["items"]
    for row in rows:
        detail = (await client.get(f"/api/v1/products/{row['id']}", headers=headers)).json()
        if any(v["id"] == variant_id for v in detail["variants"]):
            resp = await client.patch(
                f"/api/v1/products/{row['id']}", json={"sc_pwd_eligible": True}, headers=headers
            )
            assert resp.status_code == 200 and resp.json()["sc_pwd_eligible"] is True
            return
    raise AssertionError("product not found")


async def test_senior_citizen_sale_syncs_without_mismatch(
    client: AsyncClient, db: AsyncSession
) -> None:
    tenant = await signup(client)
    medicine = await stocked_item(client, tenant, name="Paracetamol 500mg", price="112.00")
    await _make_eligible(client, tenant.headers, medicine.variant_id)
    terminal = await make_terminal(client, tenant)
    sale = terminal.sale([(medicine, "1")], statutory=SENIOR)
    results = await terminal.push([terminal.open_session(), sale])
    assert [r["status"] for r in results] == ["APPLIED", "APPLIED"], results
    assert results[1]["result"]["totals_mismatch"] is False

    stored = await db.get(Sale, sale["entity_id"])
    assert stored is not None
    assert (stored.total, stored.vat_exemption_total, stored.statutory_discount_total) == (
        Decimal("80.00"),
        Decimal("12.00"),
        Decimal("20.00"),
    )
    assert stored.statutory_holder_name == "Lola Nena"
    assert stored.tax_total == Decimal("0.00")

    book = (await client.get("/api/v1/reports/sc-pwd-book", headers=tenant.headers)).json()["data"]
    assert [(r["kind"], r["id_number"], r["discount"], r["net"]) for r in book] == [
        ("SENIOR", "OSCA-12345", "20.00", "80.00")
    ]
    summary = (await client.get("/api/v1/reports/sales-summary", headers=tenant.headers)).json()[
        "data"
    ]
    assert summary["sc_pwd_discounts"] == "20.00"
    assert summary["vat_exemptions"] == "12.00"


async def test_ineligible_item_is_kept_but_flagged(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    beer = await stocked_item(client, tenant, name="Beer", price="56.00")
    terminal = await make_terminal(client, tenant)
    sale = terminal.sale([(beer, "2")], statutory={**SENIOR, "kind": "PWD"})
    results = await terminal.push([terminal.open_session(), sale])
    assert results[1]["status"] == "APPLIED"
    flag = await db.scalar(
        select(ReviewFlag).where(
            ReviewFlag.company_id == tenant.company_id,
            ReviewFlag.flag_type == "STATUTORY_DISCOUNT_REVIEW",
        )
    )
    assert flag is not None
    assert flag.details["ineligible_lines"][0]["line_no"] == "1"


async def test_statutory_lines_need_holder_details(client: AsyncClient) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant, price="112.00")
    terminal = await make_terminal(client, tenant)
    sale = terminal.sale([(item, "1")], statutory=SENIOR)
    sale["payload"].pop("statutory_discount")
    results = await terminal.push([terminal.open_session(), sale])
    assert results[1]["status"] == "REJECTED"
    assert results[1]["error"]["code"] == "sync.statutory_details_missing"


async def test_terminal_reading_and_bir_fields(client: AsyncClient) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant, price="25.00")
    terminal = await make_terminal(client, tenant)
    resp = await client.patch(
        f"/api/v1/devices/{terminal.device['id']}",
        json={
            "bir_min": "20091234567",
            "bir_serial_number": "SN-001",
            "bir_ptu_number": "FP012026",
        },
        headers=tenant.headers,
    )
    assert resp.status_code == 200
    context = (await client.get("/api/v1/sync/context", headers=terminal.headers)).json()
    assert context["device_bir"]["min"] == "20091234567"

    open_op = terminal.open_session()
    sales = [terminal.sale([(item, "2")]), terminal.sale([(item, "1")], method="GCASH")]
    await terminal.push([open_op, *sales])
    reading = (
        await client.get(
            "/api/v1/reports/terminal-reading",
            params={"device_id": terminal.device["id"]},
            headers=tenant.headers,
        )
    ).json()["data"]
    assert reading["transactions"] == 2
    assert (reading["first_receipt"], reading["last_receipt"]) == (
        "MAIN-T01-000001",
        "MAIN-T01-000002",
    )
    assert reading["net_sales"] == "75.00"
    assert Decimal(reading["old_accumulated_grand_total"]) == 0
    assert reading["new_accumulated_grand_total"] == "75.00"
    assert {p["method_kind"]: p["amount"] for p in reading["payments"]} == {
        "CASH": "50.00",
        "EWALLET": "25.00",
    }


async def test_device_can_look_up_other_terminals_sales(client: AsyncClient) -> None:
    tenant = await signup(client)
    item = await stocked_item(client, tenant, price="30.00")
    a = await make_terminal(client, tenant, terminal_code="T01")
    b = await make_terminal(client, tenant, terminal_code="T02")
    sale = a.sale([(item, "3")])
    await a.push([a.open_session(), sale])
    sale_item_id = sale["payload"]["items"][0]["id"]
    ret = b.op(
        "return.create",
        "return",
        {
            "id": str(uuid.uuid4()),
            "sale_id": sale["entity_id"],
            "return_number": "MAIN-T02-R000001",
            "cashier_id": b.cashier_id,
            "reason": "Wrong size",
            "occurred_at": datetime.now(UTC).isoformat(),
            "items": [{"id": str(uuid.uuid4()), "sale_item_id": sale_item_id, "quantity": "1"}],
            "refunds": [
                {
                    "id": str(uuid.uuid4()),
                    "payment_method_id": b.payment_methods["CASH"],
                    "amount": "30.00",
                }
            ],
        },
    )
    assert (await b.push([ret]))[0]["status"] == "APPLIED"
    found = await client.get(
        "/api/v1/sync/sales/lookup",
        params={"receipt_number": "MAIN-T01-000001"},
        headers=auth(b.token),
    )
    assert found.status_code == 200
    body = found.json()
    assert body["sale"]["id"] == sale["entity_id"]
    assert Decimal(body["returned_quantities"][sale_item_id]) == Decimal(1)
    assert Decimal(body["refunded_amounts"][sale_item_id]) == Decimal("30.00")
    missing = await client.get(
        "/api/v1/sync/sales/lookup", params={"receipt_number": "NOPE"}, headers=auth(b.token)
    )
    assert missing.status_code == 404
