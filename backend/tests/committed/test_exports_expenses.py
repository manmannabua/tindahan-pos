"""Background report export (inline job mode) and expenses, with real commits."""

from decimal import Decimal

from httpx import AsyncClient

from tests.helpers import signup
from tests.sync_helpers import make_terminal, stocked_item


async def test_report_export_to_csv(committed_client: AsyncClient, company_code: str) -> None:
    client = committed_client
    tenant = await signup(client, company_code)
    item = await stocked_item(client, tenant, name="Cola", price="25.00", stock="10")
    terminal = await make_terminal(client, tenant)
    await terminal.push([terminal.open_session(), terminal.sale([(item, "2")])])

    resp = await client.post("/api/v1/reports/sales-by-product/export", headers=tenant.headers)
    assert resp.status_code == 202, resp.text
    export_id = resp.json()["id"]
    # Inline mode runs the job right after the response.
    status = (
        await client.get(f"/api/v1/reports/exports/{export_id}", headers=tenant.headers)
    ).json()
    assert status["status"] == "DONE", status
    assert status["row_count"] == 1
    csv = await client.get(f"/api/v1/reports/exports/{export_id}/download", headers=tenant.headers)
    assert csv.headers["content-type"].startswith("text/csv")
    lines = csv.text.strip().splitlines()
    assert lines[0].startswith("variant_id,sku,product_name")
    assert "Cola" in lines[1] and ",50.00," in lines[1]


async def test_expenses_flow(committed_client: AsyncClient, company_code: str) -> None:
    client = committed_client
    tenant = await signup(client, company_code)
    categories = (await client.get("/api/v1/expense-categories", headers=tenant.headers)).json()
    utilities = next(c["id"] for c in categories if c["name"] == "Utilities")
    created = await client.post(
        "/api/v1/expenses",
        json={
            "branch_id": str(tenant.branch_id),
            "category_id": utilities,
            "expense_date": "2026-09-01",
            "amount": "1520.75",
            "paid_from": "BANK",
            "payee": "Meralco",
            "description": "Electricity August",
        },
        headers=tenant.headers,
    )
    assert created.status_code == 201, created.text
    report = (
        await client.get(
            "/api/v1/reports/expenses",
            params={"date_from": "2026-09-01", "date_to": "2026-09-30"},
            headers=tenant.headers,
        )
    ).json()["data"]
    assert [(r["category"], Decimal(r["amount"])) for r in report] == [
        ("Utilities", Decimal("1520.75"))
    ]
    voided = await client.post(
        f"/api/v1/expenses/{created.json()['id']}/void", headers=tenant.headers
    )
    assert voided.json()["voided_at"] is not None
