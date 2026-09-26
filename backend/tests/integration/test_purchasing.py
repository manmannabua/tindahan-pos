from decimal import Decimal
from typing import Any

from httpx import AsyncClient

from tests.catalog_helpers import create_product, default_location, ref_ids
from tests.helpers import Tenant, auth, create_user, login, signup


async def _setup(
    client: AsyncClient,
) -> tuple[Tenant, dict[str, Any], dict[str, Any], str, dict[str, str]]:
    tenant = await signup(client)
    ids = await ref_ids(client, tenant.headers)
    product = await create_product(
        client,
        tenant.headers,
        barcode=None,
        cost=None,
        extra={"units": [{"unit_id": ids["BOX"], "factor": "12"}]},
    )
    supplier = (
        await client.post(
            "/api/v1/suppliers",
            json={"code": "COCA", "name": "Coca-Cola Distributor", "payment_terms_days": 30},
            headers=tenant.headers,
        )
    ).json()
    location = await default_location(client, tenant.headers, tenant.branch_id)
    return tenant, product, supplier, location, ids


async def _variant(client: AsyncClient, tenant: Tenant, product_id: str) -> dict[str, Any]:
    detail = (await client.get(f"/api/v1/products/{product_id}", headers=tenant.headers)).json()
    return dict(detail["variants"][0])


async def _on_hand(client: AsyncClient, tenant: Tenant, location: str) -> Decimal:
    page = (
        await client.get(
            "/api/v1/inventory/balances",
            params={"stock_location_id": location},
            headers=tenant.headers,
        )
    ).json()
    return sum((Decimal(b["quantity"]) for b in page["items"]), Decimal(0))


async def test_purchase_order_lifecycle_and_moving_average(client: AsyncClient) -> None:
    tenant, product, supplier, location, ids = await _setup(client)
    variant_id = product["variants"][0]["id"]
    po = (
        await client.post(
            "/api/v1/purchase-orders",
            json={
                "supplier_id": supplier["id"],
                "stock_location_id": location,
                "lines": [
                    {
                        "variant_id": variant_id,
                        "unit_id": ids["BOX"],
                        "quantity": "3",
                        "unit_cost": "240.00",
                    }
                ],
            },
            headers=tenant.headers,
        )
    ).json()
    assert po["number"] == "PO-000001" and po["status"] == "DRAFT"
    assert Decimal(po["total"]) == Decimal("720.00")
    assert Decimal(po["lines"][0]["base_quantity"]) == Decimal(36)

    # Cannot receive a draft.
    line_id = po["lines"][0]["id"]
    draft_receipt = await client.post(
        "/api/v1/goods-receipts",
        json={
            "purchase_order_id": po["id"],
            "lines": [{"purchase_order_line_id": line_id, "quantity": "1"}],
        },
        headers=tenant.headers,
    )
    assert draft_receipt.status_code == 422

    await client.post(f"/api/v1/purchase-orders/{po['id']}/approve", headers=tenant.headers)

    # Receive 2 boxes at the ordered cost → 24 pcs at 20.0000 each.
    gr1 = (
        await client.post(
            "/api/v1/goods-receipts",
            json={
                "purchase_order_id": po["id"],
                "supplier_invoice_no": "INV-881",
                "lines": [{"purchase_order_line_id": line_id, "quantity": "2"}],
            },
            headers=tenant.headers,
        )
    ).json()
    assert gr1["number"] == "GR-000001"
    assert Decimal(gr1["lines"][0]["base_unit_cost"]) == Decimal("20")
    assert Decimal(gr1["total_cost"]) == Decimal("480.00")
    assert await _on_hand(client, tenant, location) == Decimal(24)
    variant = await _variant(client, tenant, product["id"])
    assert Decimal(variant["average_cost"]) == Decimal("20")
    po_now = (
        await client.get(f"/api/v1/purchase-orders/{po['id']}", headers=tenant.headers)
    ).json()
    assert po_now["status"] == "PARTIALLY_RECEIVED"

    # Over-receipt is refused (only 12 pcs remain).
    over = await client.post(
        "/api/v1/goods-receipts",
        json={
            "purchase_order_id": po["id"],
            "lines": [{"purchase_order_line_id": line_id, "quantity": "2"}],
        },
        headers=tenant.headers,
    )
    assert over.status_code == 422 and over.json()["error"]["code"] == "goods_receipt.over_receipt"

    # Last box arrives at a higher price: 264/box = 22/pc.
    # New average = (24 x 20 + 12 x 22) / 36 = 20.6667
    await client.post(
        "/api/v1/goods-receipts",
        json={
            "purchase_order_id": po["id"],
            "lines": [{"purchase_order_line_id": line_id, "quantity": "1", "unit_cost": "264.00"}],
        },
        headers=tenant.headers,
    )
    variant = await _variant(client, tenant, product["id"])
    assert Decimal(variant["average_cost"]) == Decimal("20.6667")
    assert Decimal(variant["last_cost"]) == Decimal("22")
    po_now = (
        await client.get(f"/api/v1/purchase-orders/{po['id']}", headers=tenant.headers)
    ).json()
    assert po_now["status"] == "RECEIVED"
    cancel = await client.post(f"/api/v1/purchase-orders/{po['id']}/cancel", headers=tenant.headers)
    assert cancel.status_code == 422

    movements = (
        await client.get(
            "/api/v1/inventory/movements",
            params={"movement_type": "PURCHASE"},
            headers=tenant.headers,
        )
    ).json()
    assert movements["total"] == 2


async def test_direct_receipt_without_po(client: AsyncClient) -> None:
    tenant, product, supplier, location, _ = await _setup(client)
    resp = await client.post(
        "/api/v1/goods-receipts",
        json={
            "supplier_id": supplier["id"],
            "stock_location_id": location,
            "lines": [
                {"variant_id": product["variants"][0]["id"], "quantity": "10", "unit_cost": "19.5"}
            ],
        },
        headers=tenant.headers,
    )
    assert resp.status_code == 201, resp.text
    assert await _on_hand(client, tenant, location) == Decimal(10)
    missing_cost = await client.post(
        "/api/v1/goods-receipts",
        json={
            "supplier_id": supplier["id"],
            "stock_location_id": location,
            "lines": [{"variant_id": product["variants"][0]["id"], "quantity": "1"}],
        },
        headers=tenant.headers,
    )
    assert missing_cost.status_code == 422


async def test_close_partially_received_po(client: AsyncClient) -> None:
    tenant, product, supplier, location, _ = await _setup(client)
    po = (
        await client.post(
            "/api/v1/purchase-orders",
            json={
                "supplier_id": supplier["id"],
                "stock_location_id": location,
                "lines": [
                    {
                        "variant_id": product["variants"][0]["id"],
                        "quantity": "10",
                        "unit_cost": "20",
                    }
                ],
            },
            headers=tenant.headers,
        )
    ).json()
    await client.post(f"/api/v1/purchase-orders/{po['id']}/approve", headers=tenant.headers)
    await client.post(
        "/api/v1/goods-receipts",
        json={
            "purchase_order_id": po["id"],
            "lines": [{"purchase_order_line_id": po["lines"][0]["id"], "quantity": "4"}],
        },
        headers=tenant.headers,
    )
    closed = (
        await client.post(f"/api/v1/purchase-orders/{po['id']}/close", headers=tenant.headers)
    ).json()
    assert closed["status"] == "CLOSED"


async def test_purchasing_permissions(client: AsyncClient) -> None:
    tenant, _, _, _, _ = await _setup(client)
    await create_user(client, tenant.headers, username="cathy", role_code="CASHIER")
    cashier = auth(await login(client, "cathy@example.com"))
    assert (await client.get("/api/v1/suppliers", headers=cashier)).status_code == 403
    assert (await client.get("/api/v1/purchase-orders", headers=cashier)).status_code == 403
    await create_user(client, tenant.headers, username="ivan", role_code="INVENTORY_CLERK")
    clerk = auth(await login(client, "ivan@example.com"))
    assert (await client.get("/api/v1/suppliers", headers=clerk)).status_code == 200
    assert (await client.get("/api/v1/purchase-orders", headers=clerk)).status_code == 200
