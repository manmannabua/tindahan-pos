"""Reports against a small, hand-computed day of trading.

Setup: Cola 25.00 (cost 15), Juice 67.17 (cost 50); prices include 12% VAT.
  sale 1: 2 x Cola = 50.00 cash       (VAT 5.36)
  sale 2: 1 x Juice = 67.17 GCash     (VAT 7.20)
  sale 3: 1 x Cola = 25.00 cash → voided
  return: 1 Cola from sale 1, refund 25.00 cash, restocked
Expected:
  sales 117.17, tax 12.56, returns 25.00, net sales 92.17
  refunds ex tax = 25.00 x 44.64 / 50.00 = 22.32
  revenue ex tax = 117.17 - 12.56 - 22.32 = 82.29
  cogs = (2 x 15 + 50) - 15 (restocked) = 65.00
  gross profit = 17.29, margin = 21.01 %, average ticket = 58.59 (HALF_UP)
"""

from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

from httpx import AsyncClient
from uuid_utils.compat import uuid7

from tests.helpers import Tenant, auth, create_user, login, signup
from tests.sync_helpers import make_terminal, stocked_item


async def _trading_day(client: AsyncClient) -> Tenant:
    tenant = await signup(client)
    cola = await stocked_item(client, tenant, name="Cola", price="25.00", stock="10", cost="15")
    juice = await stocked_item(client, tenant, name="Juice", price="67.17", stock="5", cost="50")
    terminal = await make_terminal(client, tenant)
    open_op = terminal.open_session("1000.00")
    sale1 = terminal.sale([(cola, "2")])
    sale2 = terminal.sale([(juice, "1")], method="GCASH")
    sale3 = terminal.sale([(cola, "1")])
    void = terminal.op(
        "sale.void",
        "sale",
        {
            "id": sale3["entity_id"],
            "voided_by_id": terminal.cashier_id,
            "reason": "Customer left",
            "occurred_at": datetime.now(UTC).isoformat(),
        },
    )
    ret = terminal.op(
        "return.create",
        "return",
        {
            "id": str(uuid7()),
            "sale_id": sale1["entity_id"],
            "return_number": "MAIN-T01-R000001",
            "cash_session_id": terminal.session_id,
            "cashier_id": terminal.cashier_id,
            "reason": "Dented can",
            "occurred_at": datetime.now(UTC).isoformat(),
            "items": [
                {
                    "id": str(uuid7()),
                    "sale_item_id": sale1["payload"]["items"][0]["id"],
                    "quantity": "1",
                }
            ],
            "refunds": [
                {
                    "id": str(uuid7()),
                    "payment_method_id": terminal.payment_methods["CASH"],
                    "amount": "25.00",
                }
            ],
        },
    )
    results = await terminal.push([open_op, sale1, sale2, sale3, void, ret])
    assert [r["status"] for r in results] == ["APPLIED"] * 6, results
    return tenant


async def _report(client: AsyncClient, headers: dict[str, str], name: str, **params: Any) -> Any:
    resp = await client.get(f"/api/v1/reports/{name}", params=params, headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


async def test_sales_summary_matches_hand_computation(client: AsyncClient) -> None:
    tenant = await _trading_day(client)
    summary = await _report(client, tenant.headers, "sales-summary")
    expected = {
        "transactions": 2,
        "sales": "117.17",
        "tax": "12.56",
        "returns_count": 1,
        "returns": "25.00",
        "net_sales": "92.17",
        "voids_count": 1,
        "voids_amount": "25.00",
        "revenue_ex_tax": "82.29",
        "cogs": "65.00",
        "gross_profit": "17.29",
        "gross_margin_pct": "21.01",
        "average_ticket": "58.59",
    }
    for key, value in expected.items():
        got = summary[key]
        assert (Decimal(got) if isinstance(value, str) else got) == (
            Decimal(value) if isinstance(value, str) else value
        ), key


async def test_breakdowns(client: AsyncClient) -> None:
    tenant = await _trading_day(client)
    by_method = await _report(client, tenant.headers, "sales-by-payment-method")
    assert {m["method"]: Decimal(m["amount"]) for m in by_method} == {
        "GCash": Decimal("67.17"),
        "Cash": Decimal("50.00"),  # the voided cash sale is excluded
    }
    by_product = await _report(client, tenant.headers, "sales-by-product")
    assert [p["product_name"] for p in by_product] == ["Juice", "Cola"]
    best = await _report(client, tenant.headers, "best-sellers")
    assert best[0]["product_name"] == "Cola"  # by quantity
    hours = await _report(client, tenant.headers, "sales-by-hour")
    assert sum(h["transactions"] for h in hours) == 2
    voids = await _report(client, tenant.headers, "voids")
    assert len(voids) == 1 and voids[0]["void_reason"] == "Customer left"
    drawer = await _report(client, tenant.headers, "cash-drawer")
    assert Decimal(drawer[0]["opening_float"]) == Decimal("1000.00")
    valuation = await _report(client, tenant.headers, "inventory-valuation")
    # Cola: 10 - 2 - 1 + 1 (void) + 1 (return) = 9 x 15 ; Juice: 5 - 1 = 4 x 50
    assert Decimal(valuation[0]["value"]) == Decimal("335.00")


async def test_cost_fields_hidden_without_financial_permission(client: AsyncClient) -> None:
    tenant = await _trading_day(client)
    await create_user(client, tenant.headers, username="mara", role_code="MANAGER")
    manager = auth(await login(client, "mara@example.com"))
    summary = await _report(client, manager, "sales-summary")
    assert summary["sales"] == "117.17"
    assert "gross_profit" not in summary and "cogs" not in summary
    await create_user(client, tenant.headers, username="carl", role_code="CASHIER")
    cashier = auth(await login(client, "carl@example.com"))
    resp = await client.get("/api/v1/reports/sales-summary", headers=cashier)
    assert resp.status_code == 403


async def test_dashboard_and_sync_monitor(client: AsyncClient) -> None:
    tenant = await _trading_day(client)
    dash = (await client.get("/api/v1/dashboard", headers=tenant.headers)).json()
    assert dash["today"]["transactions"] == 2
    assert dash["devices"]["active"] == 1 and dash["devices"]["online"] == 1
    assert len(dash["last_7_days"]) == 1
    monitor = (await client.get("/api/v1/sync/monitor", headers=tenant.headers)).json()
    assert monitor["devices"][0]["online"] is True
    assert monitor["failed_operations"] == []


async def test_report_period_validation(client: AsyncClient) -> None:
    tenant = await signup(client)
    resp = await client.get(
        "/api/v1/reports/sales-summary",
        params={"date_from": "2026-09-10", "date_to": "2026-09-01"},
        headers=tenant.headers,
    )
    assert resp.status_code == 422
    assert (await client.get("/api/v1/reports/nope", headers=tenant.headers)).status_code == 404
