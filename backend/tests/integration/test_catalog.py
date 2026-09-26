from decimal import Decimal

from httpx import AsyncClient

from tests.catalog_helpers import create_product, ref_ids
from tests.helpers import auth, create_user, login, signup


async def test_signup_seeds_reference_data(client: AsyncClient) -> None:
    tenant = await signup(client)
    ids = await ref_ids(client, tenant.headers)
    assert {"PC", "BOX", "KG", "VAT12", "VAT_EXEMPT", "RETAIL", "WHOLESALE"} <= set(ids)
    levels = (await client.get("/api/v1/price-levels", headers=tenant.headers)).json()
    assert [lvl["code"] for lvl in levels if lvl["is_default"]] == ["RETAIL"]


async def test_create_product_with_units_barcodes_and_prices(client: AsyncClient) -> None:
    tenant = await signup(client)
    ids = await ref_ids(client, tenant.headers)
    resp = await client.post(
        "/api/v1/products",
        json={
            "name": "Sardines 155g",
            "base_unit_id": ids["PC"],
            "units": [{"unit_id": ids["BOX"], "factor": "24"}],
            "variants": [
                {
                    "sku": "SARD-155",
                    "cost": "18.5000",
                    "barcodes": [
                        {"code": "036000291452", "is_primary": True},  # UPC-A → stored as EAN-13
                        {"code": "ITF-BOX-24", "unit_id": ids["BOX"]},
                    ],
                    "prices": [
                        {"price": "25.00"},
                        {"price": "23.50", "min_quantity": "12"},
                        {"price": "540.00", "unit_id": ids["BOX"]},
                        {"price": "22.00", "price_level_id": ids["WHOLESALE"]},
                    ],
                }
            ],
        },
        headers=tenant.headers,
    )
    assert resp.status_code == 201, resp.text
    product = resp.json()
    assert product["tax_rate_id"] == ids["VAT12"]  # default applied
    units = {u["unit_code"]: u for u in product["units"]}
    assert units["PC"]["is_base"] and Decimal(units["BOX"]["factor"]) == 24
    variant = product["variants"][0]
    assert variant["is_default"] and variant["sku"] == "SARD-155"
    codes = {b["code"]: b for b in variant["barcodes"]}
    assert codes["0036000291452"]["symbology"] == "EAN13"
    assert codes["ITF-BOX-24"]["product_unit_id"] == units["BOX"]["id"]
    assert len(variant["prices"]) == 4
    assert Decimal(variant["average_cost"]) == Decimal("18.5")


async def test_barcode_uniqueness_across_formats(client: AsyncClient) -> None:
    tenant = await signup(client)
    await create_product(client, tenant.headers, barcode="036000291452")
    ids = await ref_ids(client, tenant.headers)
    resp = await client.post(
        "/api/v1/products",
        json={
            "name": "Impostor",
            "base_unit_id": ids["PC"],
            "variants": [{"barcodes": [{"code": "0036000291452"}]}],
        },
        headers=tenant.headers,
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "barcode.taken"


async def test_removed_barcode_can_be_reassigned_keeping_its_row(client: AsyncClient) -> None:
    tenant = await signup(client)
    first = await create_product(client, tenant.headers, name="Old", barcode="4800361419117")
    barcode = first["variants"][0]["barcodes"][0]
    resp = await client.patch(
        f"/api/v1/barcodes/{barcode['id']}", json={"is_active": False}, headers=tenant.headers
    )
    assert resp.json()["is_active"] is False

    second = await create_product(client, tenant.headers, name="New", barcode=None)
    resp = await client.post(
        f"/api/v1/variants/{second['variants'][0]['id']}/barcodes",
        json={"code": "4800361419117"},
        headers=tenant.headers,
    )
    assert resp.status_code == 201, resp.text
    reassigned = resp.json()
    # Same row: offline terminals see an update to the barcode they already have.
    assert reassigned["id"] == barcode["id"]
    assert reassigned["variant_id"] == second["variants"][0]["id"]

    lookup = await client.get(
        "/api/v1/barcodes/lookup", params={"code": "4800361419117"}, headers=tenant.headers
    )
    assert lookup.json()["product_name"] == "New"


async def test_sku_generated_and_unique(client: AsyncClient) -> None:
    tenant = await signup(client)
    a = await create_product(client, tenant.headers, name="A", barcode=None)
    b = await create_product(client, tenant.headers, name="B", barcode=None)
    sku_a, sku_b = a["variants"][0]["sku"], b["variants"][0]["sku"]
    assert sku_a != sku_b and sku_a.startswith("P")
    resp = await client.patch(
        f"/api/v1/variants/{b['variants'][0]['id']}", json={"sku": sku_a}, headers=tenant.headers
    )
    assert resp.status_code == 409


async def test_generate_internal_barcode(client: AsyncClient) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers, barcode=None)
    resp = await client.post(
        f"/api/v1/variants/{product['variants'][0]['id']}/barcodes/generate",
        json={},
        headers=tenant.headers,
    )
    assert resp.status_code == 201
    assert resp.json()["code"].startswith("2") and resp.json()["symbology"] == "EAN13"


async def test_set_prices_replaces_and_deactivates(client: AsyncClient) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers, price="75.00")
    variant = product["variants"][0]
    original_id = variant["prices"][0]["id"]
    resp = await client.put(
        f"/api/v1/variants/{variant['id']}/prices",
        json={"prices": [{"price": "79.00"}, {"price": "70.00", "min_quantity": "6"}]},
        headers=tenant.headers,
    )
    assert resp.status_code == 200, resp.text
    prices = {Decimal(p["min_quantity"]): p for p in resp.json()}
    assert prices[Decimal(1)]["id"] == original_id  # updated in place
    assert Decimal(prices[Decimal(1)]["price"]) == Decimal("79.00")

    resp = await client.put(
        f"/api/v1/variants/{variant['id']}/prices",
        json={"prices": [{"price": "80.00"}]},
        headers=tenant.headers,
    )
    detail = (await client.get(f"/api/v1/products/{product['id']}", headers=tenant.headers)).json()
    active = [p for p in detail["variants"][0]["prices"] if p["is_active"]]
    assert len(active) == 1 and Decimal(active[0]["price"]) == Decimal("80.00")


async def test_product_search_and_summary(client: AsyncClient) -> None:
    tenant = await signup(client)
    await create_product(client, tenant.headers, name="Coke 1.5L", barcode="4800361419117")
    await create_product(
        client, tenant.headers, name="Sprite 1.5L", barcode="036000291452", price="70.00"
    )

    async def search(q: str) -> list[str]:
        resp = await client.get("/api/v1/products", params={"q": q}, headers=tenant.headers)
        return [p["name"] for p in resp.json()["items"]]

    assert await search("coke") == ["Coke 1.5L"]
    assert await search("036000291452") == ["Sprite 1.5L"]  # barcode, canonicalized
    page = (await client.get("/api/v1/products", headers=tenant.headers)).json()
    assert page["total"] == 2
    sprite = next(p for p in page["items"] if p["name"] == "Sprite 1.5L")
    assert sprite["barcode"] == "0036000291452"
    assert Decimal(sprite["price"]) == Decimal("70.00")


async def test_cashier_cannot_see_cost_or_edit(client: AsyncClient) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers)
    await create_user(client, tenant.headers, username="cathy", role_code="CASHIER")
    cashier = auth(await login(client, "cathy@example.com"))
    detail = (await client.get(f"/api/v1/products/{product['id']}", headers=cashier)).json()
    assert detail["variants"][0]["average_cost"] is None
    resp = await client.patch(
        f"/api/v1/products/{product['id']}", json={"name": "Hacked"}, headers=cashier
    )
    assert resp.status_code == 403


async def test_category_cycle_prevented(client: AsyncClient) -> None:
    tenant = await signup(client)
    parent = (
        await client.post("/api/v1/categories", json={"name": "Drinks"}, headers=tenant.headers)
    ).json()
    child = (
        await client.post(
            "/api/v1/categories",
            json={"name": "Soda", "parent_id": parent["id"]},
            headers=tenant.headers,
        )
    ).json()
    resp = await client.patch(
        f"/api/v1/categories/{parent['id']}",
        json={"parent_id": child["id"]},
        headers=tenant.headers,
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "category.cycle"
    dup = await client.post("/api/v1/categories", json={"name": "drinks"}, headers=tenant.headers)
    assert dup.status_code == 409
