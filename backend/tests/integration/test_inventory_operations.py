import uuid
from decimal import Decimal

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.inventory.models import InventoryBalance, MovementType
from app.modules.inventory.service import MovementSpec, post_movements, verify_balances
from app.modules.review_flags.models import ReviewFlag
from tests.catalog_helpers import create_product, default_location, ref_ids
from tests.helpers import Tenant, auth, create_user, login, signup


async def _setup(client: AsyncClient, stock: str = "10") -> tuple[Tenant, dict, str]:
    tenant = await signup(client)
    ids = await ref_ids(client, tenant.headers)
    product = await create_product(
        client,
        tenant.headers,
        barcode="4800361419116",
        extra={"units": [{"unit_id": ids["BOX"], "factor": "12"}]},
    )
    location = await default_location(client, tenant.headers, tenant.branch_id)
    await client.post(
        "/api/v1/inventory/initial-stock",
        json={
            "stock_location_id": location,
            "lines": [{"variant_id": product["variants"][0]["id"], "quantity": stock}],
        },
        headers=tenant.headers,
    )
    return tenant, product, location


async def _balance(db: AsyncSession, variant_id: str, location_id: str) -> Decimal:
    value = await db.scalar(
        select(InventoryBalance.quantity).where(
            InventoryBalance.variant_id == uuid.UUID(variant_id),
            InventoryBalance.stock_location_id == uuid.UUID(location_id),
        )
    )
    return value if value is not None else Decimal(0)


async def test_adjustment_in_other_unit(client: AsyncClient, db: AsyncSession) -> None:
    tenant, product, location = await _setup(client, stock="100")
    ids = await ref_ids(client, tenant.headers)
    variant = product["variants"][0]["id"]
    resp = await client.post(
        "/api/v1/inventory/adjustments",
        json={
            "stock_location_id": location,
            "reason": "Water damage in storage",
            "lines": [
                {
                    "variant_id": variant,
                    "unit_id": ids["BOX"],
                    "quantity": "2",
                    "reason": "DAMAGED",
                },
                {"barcode": "4800361419116", "quantity": "5", "reason": "ADJUSTMENT_IN"},
            ],
        },
        headers=tenant.headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["number"] == "ADJ-000001"
    assert [Decimal(line["base_quantity"]) for line in body["lines"]] == [Decimal(24), Decimal(5)]
    assert await _balance(db, variant, location) == Decimal(81)  # 100 - 24 + 5
    movements = (
        await client.get(
            "/api/v1/inventory/movements",
            params={"reference_id": body["id"]},
            headers=tenant.headers,
        )
    ).json()
    assert {m["movement_type"] for m in movements["items"]} == {"DAMAGED", "ADJUSTMENT_IN"}


async def test_count_ignores_sales_made_during_the_count(
    client: AsyncClient, db: AsyncSession
) -> None:
    tenant, product, location = await _setup(client, stock="10")
    variant = product["variants"][0]["id"]
    count = (
        await client.post(
            "/api/v1/inventory/counts", json={"stock_location_id": location}, headers=tenant.headers
        )
    ).json()
    for _ in range(3):  # three scans of the shelf
        resp = await client.post(
            f"/api/v1/inventory/counts/{count['id']}/lines",
            json={"barcode": "4800361419116"},
            headers=tenant.headers,
        )
        assert resp.status_code == 200, resp.text
    assert Decimal(resp.json()["counted_quantity"]) == Decimal(3)
    assert Decimal(resp.json()["system_quantity"]) == Decimal(10)

    # A customer buys one unit after the shelf was counted but before the count is completed.
    await post_movements(
        db,
        tenant.company_id,
        [
            MovementSpec(
                variant_id=uuid.UUID(variant),
                stock_location_id=uuid.UUID(location),
                quantity=Decimal(1),
                movement_type=MovementType.SALE,
            )
        ],
        user_id=None,
    )

    done = (
        await client.post(
            f"/api/v1/inventory/counts/{count['id']}/complete", headers=tenant.headers
        )
    ).json()
    assert done["status"] == "COMPLETED"
    assert Decimal(done["lines"][0]["variance"]) == Decimal(-7)
    # Physically: 3 on the shelf when counted, then 1 sold → 2. Not 3.
    assert await _balance(db, variant, location) == Decimal(2)
    assert await verify_balances(db, tenant.company_id) == []


async def test_full_count_zeroes_uncounted_items(client: AsyncClient, db: AsyncSession) -> None:
    tenant, product, location = await _setup(client, stock="10")
    other = await create_product(client, tenant.headers, name="Sprite", barcode=None)
    await client.post(
        "/api/v1/inventory/initial-stock",
        json={
            "stock_location_id": location,
            "lines": [{"variant_id": other["variants"][0]["id"], "quantity": "4"}],
        },
        headers=tenant.headers,
    )
    count = (
        await client.post(
            "/api/v1/inventory/counts",
            json={"stock_location_id": location, "is_full": True},
            headers=tenant.headers,
        )
    ).json()
    await client.post(
        f"/api/v1/inventory/counts/{count['id']}/lines",
        json={"variant_id": product["variants"][0]["id"], "quantity": "9", "mode": "SET"},
        headers=tenant.headers,
    )
    await client.post(f"/api/v1/inventory/counts/{count['id']}/complete", headers=tenant.headers)
    assert await _balance(db, product["variants"][0]["id"], location) == Decimal(9)
    assert await _balance(db, other["variants"][0]["id"], location) == Decimal(0)


async def test_transfer_with_shortage(client: AsyncClient, db: AsyncSession) -> None:
    tenant, product, source = await _setup(client, stock="50")
    variant = product["variants"][0]["id"]
    branch_b = (
        await client.post(
            "/api/v1/branches", json={"code": "B2", "name": "Two"}, headers=tenant.headers
        )
    ).json()
    target = branch_b["locations"][0]["id"]

    transfer = (
        await client.post(
            "/api/v1/inventory/transfers",
            json={
                "from_location_id": source,
                "to_location_id": target,
                "lines": [{"variant_id": variant, "quantity": "20"}],
            },
            headers=tenant.headers,
        )
    ).json()
    assert transfer["status"] == "DRAFT" and transfer["number"] == "TRF-000001"
    assert await _balance(db, variant, source) == Decimal(50)  # drafts move nothing

    sent = (
        await client.post(
            f"/api/v1/inventory/transfers/{transfer['id']}/send", headers=tenant.headers
        )
    ).json()
    assert sent["status"] == "IN_TRANSIT"
    assert await _balance(db, variant, source) == Decimal(30)
    assert await _balance(db, variant, target) == Decimal(0)

    line_id = transfer["lines"][0]["id"]
    received = (
        await client.post(
            f"/api/v1/inventory/transfers/{transfer['id']}/receive",
            json={"lines": [{"line_id": line_id, "received_base_quantity": "18"}]},
            headers=tenant.headers,
        )
    ).json()
    assert received["status"] == "RECEIVED"
    assert await _balance(db, variant, target) == Decimal(18)
    flag = await db.scalar(
        select(ReviewFlag).where(
            ReviewFlag.company_id == tenant.company_id,
            ReviewFlag.flag_type == "TRANSFER_DISCREPANCY",
        )
    )
    assert flag is not None and flag.details["lines"][0]["received"] == "18.000"


async def test_cancel_in_transit_returns_goods(client: AsyncClient, db: AsyncSession) -> None:
    tenant, product, source = await _setup(client, stock="10")
    variant = product["variants"][0]["id"]
    target = (
        await client.post(
            f"/api/v1/branches/{tenant.branch_id}/locations",
            json={"code": "WH", "name": "Warehouse", "location_type": "WAREHOUSE"},
            headers=tenant.headers,
        )
    ).json()["id"]
    transfer = (
        await client.post(
            "/api/v1/inventory/transfers",
            json={
                "from_location_id": source,
                "to_location_id": target,
                "lines": [{"variant_id": variant, "quantity": "4"}],
            },
            headers=tenant.headers,
        )
    ).json()
    await client.post(f"/api/v1/inventory/transfers/{transfer['id']}/send", headers=tenant.headers)
    assert await _balance(db, variant, source) == Decimal(6)
    cancelled = (
        await client.post(
            f"/api/v1/inventory/transfers/{transfer['id']}/cancel", headers=tenant.headers
        )
    ).json()
    assert cancelled["status"] == "CANCELLED"
    assert await _balance(db, variant, source) == Decimal(10)
    again = await client.post(
        f"/api/v1/inventory/transfers/{transfer['id']}/send", headers=tenant.headers
    )
    assert again.status_code == 422


async def test_cashier_cannot_adjust_or_count(client: AsyncClient) -> None:
    tenant, product, location = await _setup(client)
    await create_user(client, tenant.headers, username="cathy", role_code="CASHIER")
    cashier = auth(await login(client, "cathy@example.com"))
    resp = await client.post(
        "/api/v1/inventory/adjustments",
        json={
            "stock_location_id": location,
            "reason": "Found some",
            "lines": [
                {
                    "variant_id": product["variants"][0]["id"],
                    "quantity": "1",
                    "reason": "ADJUSTMENT_IN",
                }
            ],
        },
        headers=cashier,
    )
    assert resp.status_code == 403
    resp = await client.post(
        "/api/v1/inventory/counts", json={"stock_location_id": location}, headers=cashier
    )
    assert resp.status_code == 403
