"""Pull protocol (docs/SYNC_PROTOCOL.md §4)."""

from typing import Any

from httpx import AsyncClient

from tests.catalog_helpers import create_product
from tests.helpers import auth, create_user, signup
from tests.sync_helpers import make_terminal, stocked_item


async def pull_all(
    client: AsyncClient, token: str, cursor: str | None, limit: int
) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]], str]:
    """Follow pages until has_more is false. Returns (rows by table, pages, final cursor)."""
    rows: dict[str, list[dict[str, Any]]] = {}
    pages = []
    while True:
        params: dict[str, Any] = {"limit": limit}
        if cursor:
            params["cursor"] = cursor
        resp = await client.get("/api/v1/sync/pull", params=params, headers=auth(token))
        assert resp.status_code == 200, resp.text
        page = resp.json()
        pages.append(page)
        for table, items in page["changes"].items():
            rows.setdefault(table, []).extend(items)
        cursor = page["next_cursor"]
        if not page["has_more"]:
            return rows, pages, cursor


async def test_initial_download_is_complete_and_paginated(
    committed_client: AsyncClient, company_code: str
) -> None:
    client = committed_client
    tenant = await signup(client, company_code)
    for i in range(7):
        await stocked_item(client, tenant, name=f"Item {i}", stock="10")
    terminal = await make_terminal(client, tenant)

    rows, pages, _ = await pull_all(client, terminal.token, None, limit=5)
    assert len(pages) > 3  # really paginated

    counts = pages[0]["counts"]
    for table, count in counts.items():
        assert len(rows.get(table, [])) == count, table
    for table in ("products", "product_variants", "product_units", "prices", "inventory_balances"):
        ids = [r.get("id") or (r["stock_location_id"], r["variant_id"]) for r in rows[table]]
        assert len(ids) == len(set(ids)) == 7, table  # every row exactly once
    assert {r["code"] for r in rows["payment_methods"]} >= {"CASH", "GCASH", "MAYA"}
    assert rows["companies"][0]["code"] == company_code
    assert [p["staff"] is not None for p in pages] == [True] + [False] * (len(pages) - 1)


async def test_incremental_pull_returns_only_changes(
    committed_client: AsyncClient, company_code: str
) -> None:
    client = committed_client
    tenant = await signup(client, company_code)
    product = await create_product(client, tenant.headers, name="Coke", barcode="4800361419116")
    await create_product(client, tenant.headers, name="Sprite", barcode=None)
    terminal = await make_terminal(client, tenant)
    _, _, cursor = await pull_all(client, terminal.token, None, limit=1000)

    # Nothing changed → nothing returned.
    rows, pages, cursor = await pull_all(client, terminal.token, cursor, limit=1000)
    assert rows == {} and pages[0]["counts"] is None

    await client.patch(
        f"/api/v1/products/{product['id']}", json={"name": "Coke Zero"}, headers=tenant.headers
    )
    barcode_id = product["variants"][0]["barcodes"][0]["id"]
    await client.patch(
        f"/api/v1/barcodes/{barcode_id}", json={"is_active": False}, headers=tenant.headers
    )
    rows, _, _ = await pull_all(client, terminal.token, cursor, limit=1000)
    assert [p["name"] for p in rows["products"]] == ["Coke Zero"]
    assert [(b["code"], b["is_active"]) for b in rows["barcodes"]] == [("4800361419116", False)]
    assert set(rows) == {"products", "barcodes"}


async def test_branch_scoping(committed_client: AsyncClient, company_code: str) -> None:
    client = committed_client
    tenant = await signup(client, company_code)
    other = (
        await client.post(
            "/api/v1/branches", json={"code": "B2", "name": "Two"}, headers=tenant.headers
        )
    ).json()
    item = await stocked_item(client, tenant, stock="10")
    # A branch-specific price for the other branch must not reach this terminal.
    await client.put(
        f"/api/v1/variants/{item.variant_id}/prices",
        json={"prices": [{"price": "25.00"}, {"price": "30.00", "branch_id": other["id"]}]},
        headers=tenant.headers,
    )
    other_location = other["locations"][0]["id"]
    await client.post(
        "/api/v1/inventory/initial-stock",
        json={
            "stock_location_id": other_location,
            "lines": [{"variant_id": item.variant_id, "quantity": "3"}],
        },
        headers=tenant.headers,
    )
    terminal = await make_terminal(client, tenant)
    rows, _, _ = await pull_all(client, terminal.token, None, limit=1000)

    assert {p["branch_id"] for p in rows["prices"] if p["is_active"]} == {None}
    assert [b["stock_location_id"] for b in rows["inventory_balances"]] != [other_location]
    assert len(rows["inventory_balances"]) == 1
    assert [b["code"] for b in rows["branches"]] == ["MAIN"]


async def test_staff_snapshot_has_verifiers_only_for_pos_users(
    committed_client: AsyncClient, company_code: str
) -> None:
    client = committed_client
    tenant = await signup(client, company_code)
    domain = tenant.email.split("@")[1]
    await create_user(
        client,
        tenant.headers,
        username="cathy",
        role_code="CASHIER",
        pin="482915",
        email=f"cathy@{domain}",
    )
    await create_user(
        client,
        tenant.headers,
        username="acct",
        role_code="ACCOUNTANT",
        pin="739104",
        email=f"acct@{domain}",
    )
    terminal = await make_terminal(client, tenant, cashier="cathy")
    resp = await client.get("/api/v1/sync/pull", headers=auth(terminal.token))
    staff = {s["username"]: s for s in resp.json()["staff"]}

    assert staff["cathy"]["can_use_pos"] and staff["cathy"]["pin_offline_verifier"]
    assert "pos.access" in staff["cathy"]["permissions"]
    assert "sales.void" not in staff["cathy"]["permissions"]
    # Accountants can't use the POS: no verifier leaves the server for them.
    assert not staff["acct"]["can_use_pos"]
    assert staff["acct"]["pin_offline_verifier"] is None and staff["acct"]["permissions"] == []


async def test_pull_requires_device_token(committed_client: AsyncClient, company_code: str) -> None:
    tenant = await signup(committed_client, company_code)
    resp = await committed_client.get("/api/v1/sync/pull", headers=tenant.headers)
    assert resp.status_code == 401
