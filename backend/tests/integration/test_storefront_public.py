"""The public (anonymous) online catalog: visibility, isolation, stock, prices and field leaks."""

import uuid
from decimal import Decimal
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.inventory.models import MovementType
from app.modules.inventory.service import MovementSpec, post_movements
from app.modules.storefront import router as storefront_router
from tests.catalog_helpers import create_product, default_location
from tests.helpers import Tenant, signup

BASE = "/api/v1/public/stores"

# The complete public contract. A new field must be added here on purpose — anything internal
# (cost, SKU, barcode, supplier, reorder point, ...) showing up in these responses fails the test.
STORE_FIELDS = {
    "slug", "name", "about", "phone", "messenger_url", "hours", "currency", "show_prices",
    "stock_display", "allow_indexing", "branches", "categories",
}  # fmt: skip
BRANCH_FIELDS = {"id", "name", "address", "phone", "synced_at"}
CATEGORY_FIELDS = {"id", "name", "product_count"}
PAGE_FIELDS = {"items", "total", "limit", "offset", "branch_id", "synced_at"}
CARD_FIELDS = {
    "id", "name", "brand", "category", "image_url", "unit", "price", "price_varies",
    "availability", "quantity", "variant_count",
}  # fmt: skip
DETAIL_FIELDS = CARD_FIELDS | {"description", "variants"}
VARIANT_FIELDS = {"id", "name", "price", "availability", "quantity"}


async def publish_store(client: AsyncClient, tenant: Tenant, **overrides: Any) -> None:
    body = {"slug": "acme", "enabled": True, "branch_ids": [str(tenant.branch_id)], **overrides}
    resp = await client.put("/api/v1/storefront", json=body, headers=tenant.headers)
    assert resp.status_code == 200, resp.text


async def show_online(client: AsyncClient, tenant: Tenant, *products: dict[str, Any]) -> None:
    resp = await client.post(
        "/api/v1/products/show-online",
        json={"show_online": True, "product_ids": [p["id"] for p in products]},
        headers=tenant.headers,
    )
    assert resp.status_code == 200, resp.text


async def stock(
    db: AsyncSession, tenant: Tenant, location: str, product: dict[str, Any], qty: str
) -> None:
    """Receive (qty > 0) or sell (qty < 0) through the ledger, like the POS sync does."""
    amount = Decimal(qty)
    await post_movements(
        db,
        tenant.company_id,
        [
            MovementSpec(
                variant_id=uuid.UUID(product["variants"][0]["id"]),
                stock_location_id=uuid.UUID(location),
                quantity=abs(amount),
                movement_type=MovementType.INITIAL_STOCK if amount > 0 else MovementType.SALE,
                unit_cost=Decimal(60) if amount > 0 else None,
            )
        ],
        user_id=None,
    )
    await db.commit()


async def items(client: AsyncClient, **params: Any) -> list[dict[str, Any]]:
    resp = await client.get(f"{BASE}/acme/products", params=params)
    assert resp.status_code == 200, resp.text
    return list(resp.json()["items"])


async def test_unknown_disabled_and_unpublished_look_the_same(client: AsyncClient) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers)

    for path in ("", "/products", f"/products/{product['id']}"):
        resp = await client.get(f"{BASE}/acme{path}")
        assert resp.status_code == 404
        assert resp.json()["error"]["code"] == "store.not_found"

    await publish_store(client, tenant, enabled=False)
    assert (await client.get(f"{BASE}/acme")).status_code == 404

    await publish_store(client, tenant)
    assert (await client.get(f"{BASE}/acme")).status_code == 200
    # The product exists but is not shown online.
    assert await items(client) == []
    resp = await client.get(f"{BASE}/acme/products/{product['id']}")
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "store.product_not_found"


async def test_public_fields_never_leak(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    location = await default_location(client, tenant.headers, tenant.branch_id)
    category = (
        await client.post("/api/v1/categories", json={"name": "Drinks"}, headers=tenant.headers)
    ).json()
    product = await create_product(
        client, tenant.headers, extra={"category_id": category["id"], "description": "Cold"}
    )
    await stock(db, tenant, location, product, "10")
    await show_online(client, tenant, product)
    await publish_store(client, tenant, stock_display="QUANTITY")

    store = (await client.get(f"{BASE}/acme")).json()
    assert set(store) == STORE_FIELDS
    assert all(set(b) == BRANCH_FIELDS for b in store["branches"])
    assert store["categories"] == [{"id": category["id"], "name": "Drinks", "product_count": 1}]
    assert all(set(c) == CATEGORY_FIELDS for c in store["categories"])

    page = (await client.get(f"{BASE}/acme/products")).json()
    assert set(page) == PAGE_FIELDS
    assert set(page["items"][0]) == CARD_FIELDS

    detail = (await client.get(f"{BASE}/acme/products/{product['id']}")).json()
    assert set(detail) == DETAIL_FIELDS
    assert all(set(v) == VARIANT_FIELDS for v in detail["variants"])
    assert detail["description"] == "Cold"

    # Belt and braces: none of the internal values appear anywhere in the response text.
    text = (await client.get(f"{BASE}/acme/products/{product['id']}")).text
    for secret in ("60.0000", "4800361419117", product["variants"][0]["sku"]):
        assert secret not in text


async def test_other_companies_products_never_appear(client: AsyncClient) -> None:
    tenant = await signup(client)
    other = await signup(client, code="OTHER")
    mine = await create_product(client, tenant.headers, name="Coke 1.5L")
    theirs = await create_product(client, other.headers, name="Coke 1.5L")
    await show_online(client, tenant, mine)
    await show_online(client, other, theirs)
    await publish_store(client, tenant)

    assert [i["id"] for i in await items(client)] == [mine["id"]]
    assert (await client.get(f"{BASE}/acme/products/{theirs['id']}")).status_code == 404
    # Another company's branch cannot be requested either.
    resp = await client.get(f"{BASE}/acme/products", params={"branch_id": str(other.branch_id)})
    assert resp.status_code == 404


async def test_availability_modes_and_negative_stock(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    location = await default_location(client, tenant.headers, tenant.branch_id)
    plenty = await create_product(client, tenant.headers, name="A plenty", barcode=None)
    few = await create_product(client, tenant.headers, name="B few", barcode=None)
    none = await create_product(client, tenant.headers, name="C none", barcode=None)
    oversold = await create_product(client, tenant.headers, name="D oversold", barcode=None)
    service = await create_product(
        client, tenant.headers, name="E service", barcode=None, track_inventory=False
    )
    await stock(db, tenant, location, plenty, "20")
    await stock(db, tenant, location, few, "3")
    await stock(db, tenant, location, oversold, "1")
    await stock(db, tenant, location, oversold, "-4")  # two offline terminals oversold it
    await show_online(client, tenant, plenty, few, none, oversold, service)

    await publish_store(client, tenant)  # default: availability only, low at <= 5
    cards = await items(client)
    assert [(c["name"], c["availability"], c["quantity"]) for c in cards] == [
        ("A plenty", "IN_STOCK", None),
        ("B few", "LOW_STOCK", None),
        ("C none", "OUT_OF_STOCK", None),
        ("D oversold", "OUT_OF_STOCK", None),
        ("E service", "IN_STOCK", None),
    ]
    in_stock = await items(client, in_stock=True)
    assert [c["name"] for c in in_stock] == ["A plenty", "B few", "E service"]

    await publish_store(client, tenant, stock_display="QUANTITY", low_stock_threshold="2")
    cards = await items(client)
    assert [(c["availability"], c["quantity"]) for c in cards] == [
        ("IN_STOCK", "20.000"),
        ("IN_STOCK", "3.000"),
        ("OUT_OF_STOCK", "0"),
        ("OUT_OF_STOCK", "0"),  # never a negative number in public
        ("IN_STOCK", None),
    ]

    await publish_store(client, tenant, stock_display="HIDDEN")
    assert {(c["availability"], c["quantity"]) for c in await items(client)} == {(None, None)}


async def test_stock_counts_only_the_selected_branch_and_sellable_locations(
    client: AsyncClient, db: AsyncSession
) -> None:
    tenant = await signup(client)
    main_floor = await default_location(client, tenant.headers, tenant.branch_id)
    warehouse = (
        await client.post(
            f"/api/v1/branches/{tenant.branch_id}/locations",
            json={"code": "WH", "name": "Warehouse", "location_type": "WAREHOUSE"},
            headers=tenant.headers,
        )
    ).json()["id"]
    second = (
        await client.post(
            "/api/v1/branches",
            json={"code": "B2", "name": "Second Branch", "address": "Cebu"},
            headers=tenant.headers,
        )
    ).json()
    second_floor = await default_location(client, tenant.headers, second["id"])
    product = await create_product(client, tenant.headers, barcode=None)
    await stock(db, tenant, main_floor, product, "2")
    await stock(db, tenant, warehouse, product, "100")  # not sellable to walk-in customers
    await stock(db, tenant, second_floor, product, "40")
    await show_online(client, tenant, product)
    await publish_store(
        client,
        tenant,
        stock_display="QUANTITY",
        branch_ids=[str(second["id"]), str(tenant.branch_id)],
    )

    store = (await client.get(f"{BASE}/acme")).json()
    assert [b["name"] for b in store["branches"]] == ["Second Branch", "Main Branch"]
    # The first listed branch is the default.
    assert (await items(client))[0]["quantity"] == "40.000"
    main = await items(client, branch_id=str(tenant.branch_id))
    assert main[0]["quantity"] == "2.000"


async def test_prices(client: AsyncClient) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers, price="75.00")
    await client.post(
        f"/api/v1/products/{product['id']}/variants",
        json={"name": "Zero sugar", "prices": [{"price": "80.00"}]},
        headers=tenant.headers,
    )
    local = await create_product(client, tenant.headers, name="Local price", barcode=None)
    variant = local["variants"][0]["id"]
    resp = await client.put(
        f"/api/v1/variants/{variant}/prices",
        json={
            "prices": [{"price": "75.00"}, {"price": "70.00", "branch_id": str(tenant.branch_id)}]
        },
        headers=tenant.headers,
    )
    assert resp.status_code == 200, resp.text
    await show_online(client, tenant, product, local)
    await publish_store(client, tenant)

    cards = {c["name"]: c for c in await items(client)}
    assert (cards["Coke 1.5L"]["price"], cards["Coke 1.5L"]["price_varies"]) == ("75.00", True)
    assert cards["Coke 1.5L"]["variant_count"] == 2
    assert cards["Local price"]["price"] == "70.00"  # branch price beats the company price
    detail = (await client.get(f"{BASE}/acme/products/{product['id']}")).json()
    assert sorted(v["price"] for v in detail["variants"]) == ["75.00", "80.00"]

    await publish_store(client, tenant, show_prices=False)
    assert {c["price"] for c in await items(client)} == {None}


async def test_search_and_category_filter(client: AsyncClient) -> None:
    tenant = await signup(client)
    food = (
        await client.post("/api/v1/categories", json={"name": "Food"}, headers=tenant.headers)
    ).json()
    noodles = (
        await client.post(
            "/api/v1/categories",
            json={"name": "Noodles", "parent_id": food["id"]},
            headers=tenant.headers,
        )
    ).json()
    brand = (
        await client.post("/api/v1/brands", json={"name": "Lucky Me"}, headers=tenant.headers)
    ).json()
    pancit = await create_product(
        client,
        tenant.headers,
        name="Pancit Canton 100% Original",
        barcode=None,
        extra={"category_id": noodles["id"], "brand_id": brand["id"]},
    )
    bread = await create_product(
        client, tenant.headers, name="Pandesal", barcode=None, extra={"category_id": food["id"]}
    )
    soap = await create_product(client, tenant.headers, name="Soap", barcode=None)
    await show_online(client, tenant, pancit, bread, soap)
    await publish_store(client, tenant)

    names = lambda cards: [c["name"] for c in cards]  # noqa: E731
    assert names(await items(client, q="pan")) == ["Pancit Canton 100% Original", "Pandesal"]
    assert names(await items(client, q="lucky")) == ["Pancit Canton 100% Original"]
    # LIKE wildcards in the search are literal.
    assert names(await items(client, q="100%")) == ["Pancit Canton 100% Original"]
    assert names(await items(client, q="%")) == ["Pancit Canton 100% Original"]
    assert await items(client, q="_") == []
    # A category includes its sub-categories.
    assert names(await items(client, category_id=food["id"])) == [
        "Pancit Canton 100% Original",
        "Pandesal",
    ]
    assert names(await items(client, category_id=noodles["id"])) == ["Pancit Canton 100% Original"]
    page = (await client.get(f"{BASE}/acme/products", params={"limit": 1, "offset": 1})).json()
    assert page["total"] == 3 and names(page["items"]) == ["Pandesal"]
    assert (await client.get(f"{BASE}/acme/products", params={"limit": 500})).status_code == 422


async def test_owner_changes_apply_immediately_despite_cache(client: AsyncClient) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers)
    await show_online(client, tenant, product)
    await publish_store(client, tenant)
    assert len(await items(client)) == 1  # now cached

    resp = await client.patch(
        f"/api/v1/products/{product['id']}", json={"show_online": False}, headers=tenant.headers
    )
    assert resp.status_code == 200
    assert await items(client) == []

    await show_online(client, tenant, product)
    assert len(await items(client)) == 1
    await publish_store(client, tenant, enabled=False)
    assert (await client.get(f"{BASE}/acme/products")).status_code == 404


async def test_public_responses_are_cacheable_and_rate_limited(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant = await signup(client)
    await publish_store(client, tenant)
    resp = await client.get(f"{BASE}/ACME")  # links are case-insensitive
    assert resp.status_code == 200
    assert resp.headers["cache-control"] == "public, max-age=15"
    assert resp.headers["x-robots-tag"] == "noindex"

    monkeypatch.setattr(storefront_router, "PUBLIC_RATE_LIMIT_PER_MINUTE", 3)
    statuses = [(await client.get(f"{BASE}/acme")).status_code for _ in range(4)]
    assert statuses[-1] == 429
