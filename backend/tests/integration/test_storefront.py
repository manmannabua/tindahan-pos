"""Owner side of the online catalog: settings and which products are shown online."""

from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditLog
from tests.catalog_helpers import create_product
from tests.helpers import create_user, login, signup


def settings(branch_id: object, **overrides: Any) -> dict[str, Any]:
    return {
        "slug": "acme-store",
        "enabled": True,
        "branch_ids": [str(branch_id)],
        **overrides,
    }


async def test_defaults_before_first_save(client: AsyncClient) -> None:
    tenant = await signup(client, code="SARI-1")
    body = (await client.get("/api/v1/storefront", headers=tenant.headers)).json()
    assert body["configured"] is False
    assert body["enabled"] is False
    assert body["slug"] == "sari-1"
    assert body["branch_ids"] == [str(tenant.branch_id)]
    assert body["stock_display"] == "AVAILABILITY"
    assert body["allow_indexing"] is False
    assert body["published_products"] == 0


async def test_save_update_and_audit(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    resp = await client.put(
        "/api/v1/storefront",
        json=settings(tenant.branch_id, slug="  Acme-Store ", phone="0917 000 0000"),
        headers=tenant.headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["configured"] is True and body["slug"] == "acme-store"
    assert body["phone"] == "0917 000 0000"

    resp = await client.put(
        "/api/v1/storefront",
        json=settings(tenant.branch_id, stock_display="QUANTITY", phone=""),
        headers=tenant.headers,
    )
    assert resp.json()["stock_display"] == "QUANTITY" and resp.json()["phone"] is None

    entries = list(
        await db.scalars(select(AuditLog).where(AuditLog.action == "storefront.updated"))
    )
    assert len(entries) == 2
    assert entries[1].changes == {
        "stock_display": ["AVAILABILITY", "QUANTITY"],
        "phone": ["0917 000 0000", None],
    }


async def test_validation(client: AsyncClient) -> None:
    tenant = await signup(client)
    other = await signup(client, code="OTHER")
    put = lambda body, headers=tenant.headers: client.put(  # noqa: E731
        "/api/v1/storefront", json=body, headers=headers
    )

    assert (await put(settings(tenant.branch_id, slug="a b"))).status_code == 422
    assert (await put(settings(tenant.branch_id, slug="-bad"))).status_code == 422
    assert (await put(settings(tenant.branch_id, branch_ids=[]))).status_code == 422
    # A catalog can be saved disabled without branches.
    assert (await put(settings(tenant.branch_id, enabled=False, branch_ids=[]))).status_code == 200
    bad_link = settings(tenant.branch_id, messenger_url="javascript:alert(1)")
    assert (await put(bad_link)).status_code == 422
    good_link = settings(tenant.branch_id, messenger_url="https://m.me/acme")
    assert (await put(good_link)).status_code == 200
    # Another company's branch is not accepted.
    assert (await put(settings(other.branch_id))).status_code == 422
    # Links are unique across companies.
    resp = await put(settings(other.branch_id), headers=other.headers)
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "storefront.slug_taken"


async def test_only_owners_manage_settings(client: AsyncClient) -> None:
    tenant = await signup(client)
    await create_user(client, tenant.headers, username="cashier", role_code="CASHIER")
    cashier = {"Authorization": f"Bearer {await login(client, 'cashier@example.com')}"}
    assert (await client.get("/api/v1/storefront", headers=cashier)).status_code == 403
    resp = await client.put("/api/v1/storefront", json=settings(tenant.branch_id), headers=cashier)
    assert resp.status_code == 403
    product = await create_product(client, tenant.headers)
    resp = await client.post(
        "/api/v1/products/show-online",
        json={"show_online": True, "product_ids": [product["id"]]},
        headers=cashier,
    )
    assert resp.status_code == 403


async def test_products_are_hidden_by_default_and_toggle(client: AsyncClient) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers)
    assert product["show_online"] is False

    resp = await client.patch(
        f"/api/v1/products/{product['id']}", json={"show_online": True}, headers=tenant.headers
    )
    assert resp.status_code == 200 and resp.json()["show_online"] is True

    listing = await client.get(
        "/api/v1/products", params={"online": "true"}, headers=tenant.headers
    )
    assert [p["id"] for p in listing.json()["items"]] == [product["id"]]
    listing = await client.get(
        "/api/v1/products", params={"online": "false"}, headers=tenant.headers
    )
    assert listing.json()["items"] == []


async def test_bulk_by_ids_and_by_filter(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    other = await signup(client, code="OTHER")
    coke = await create_product(client, tenant.headers, name="Coke 1.5L", barcode=None)
    sprite = await create_product(client, tenant.headers, name="Sprite 1.5L", barcode=None)
    soap = await create_product(client, tenant.headers, name="Safeguard Soap", barcode=None)
    foreign = await create_product(client, other.headers, name="Coke 1.5L", barcode=None)
    bulk = "/api/v1/products/show-online"

    # By filter: every product matching "1.5L" (never another company's).
    resp = await client.post(
        bulk, json={"show_online": True, "filter": {"q": "1.5L"}}, headers=tenant.headers
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"updated": 2}
    # Already published products are not counted again.
    resp = await client.post(
        bulk,
        json={"show_online": True, "product_ids": [coke["id"], soap["id"], foreign["id"]]},
        headers=tenant.headers,
    )
    assert resp.json() == {"updated": 1}
    online = await client.get("/api/v1/products", params={"online": True}, headers=tenant.headers)
    assert {p["id"] for p in online.json()["items"]} == {coke["id"], sprite["id"], soap["id"]}
    foreign_now = await client.get(f"/api/v1/products/{foreign['id']}", headers=other.headers)
    assert foreign_now.json()["show_online"] is False

    resp = await client.post(
        bulk, json={"show_online": False, "product_ids": [sprite["id"]]}, headers=tenant.headers
    )
    assert resp.json() == {"updated": 1}

    # Exactly one target is required.
    resp = await client.post(bulk, json={"show_online": True}, headers=tenant.headers)
    assert resp.status_code == 422

    actions = list(
        await db.scalars(
            select(AuditLog.extra).where(AuditLog.action == "product.show_online_changed")
        )
    )
    assert [(m["show_online"], m["count"]) for m in actions][:3] == [
        (True, 2),
        (True, 1),
        (False, 1),
    ]

    summary = (await client.get("/api/v1/storefront", headers=tenant.headers)).json()
    assert summary["published_products"] == 2

    # "Hide everything currently shown online" (the Online filter of the product list).
    resp = await client.post(
        bulk, json={"show_online": False, "filter": {"online": True}}, headers=tenant.headers
    )
    assert resp.json() == {"updated": 2}
    summary = (await client.get("/api/v1/storefront", headers=tenant.headers)).json()
    assert summary["published_products"] == 0
