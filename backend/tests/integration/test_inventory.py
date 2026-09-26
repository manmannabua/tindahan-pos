import uuid
from decimal import Decimal

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.inventory.models import InventoryBalance, MovementType
from app.modules.inventory.service import MovementSpec, post_movements, verify_balances
from app.modules.review_flags.models import ReviewFlag
from app.shared.ids import derived_id
from tests.catalog_helpers import create_product, default_location
from tests.helpers import signup


async def _stock(
    client: AsyncClient, headers: dict[str, str], location: str, variant: str, qty: str
) -> None:
    resp = await client.post(
        "/api/v1/inventory/initial-stock",
        json={
            "stock_location_id": location,
            "lines": [{"variant_id": variant, "quantity": qty, "unit_cost": "60"}],
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text


async def test_initial_stock_creates_ledger_and_balance(
    client: AsyncClient, db: AsyncSession
) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers)
    variant = product["variants"][0]["id"]
    location = await default_location(client, tenant.headers, tenant.branch_id)
    await _stock(client, tenant.headers, location, variant, "5")

    balances = (await client.get("/api/v1/inventory/balances", headers=tenant.headers)).json()
    assert [Decimal(b["quantity"]) for b in balances["items"]] == [Decimal(5)]
    movements = (
        await client.get(
            "/api/v1/inventory/movements", params={"variant_id": variant}, headers=tenant.headers
        )
    ).json()
    assert movements["items"][0]["movement_type"] == "INITIAL_STOCK"
    assert Decimal(movements["items"][0]["signed_quantity"]) == Decimal(5)
    assert await verify_balances(db, tenant.company_id) == []


async def test_ledger_is_append_only(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers)
    location = await default_location(client, tenant.headers, tenant.branch_id)
    await _stock(client, tenant.headers, location, product["variants"][0]["id"], "5")
    with pytest.raises(DBAPIError, match="append-only"):
        async with db.begin_nested():
            await db.execute(text("UPDATE inventory_movements SET quantity = 999"))


async def test_two_offline_terminals_oversell(client: AsyncClient, db: AsyncSession) -> None:
    """docs/INVENTORY_LEDGER.md §7: stock 5, terminal A sells 4, terminal B sells 3."""
    tenant = await signup(client)
    product = await create_product(client, tenant.headers)
    variant = uuid.UUID(product["variants"][0]["id"])
    location = uuid.UUID(await default_location(client, tenant.headers, tenant.branch_id))
    await _stock(client, tenant.headers, str(location), str(variant), "5")

    sale_a, sale_b = uuid.uuid4(), uuid.uuid4()
    for sale, qty in ((sale_a, "4"), (sale_b, "3")):
        await post_movements(
            db,
            tenant.company_id,
            [
                MovementSpec(
                    id=derived_id(sale, "SALE"),
                    variant_id=variant,
                    stock_location_id=location,
                    quantity=Decimal(qty),
                    movement_type=MovementType.SALE,
                    reference_type="sale",
                    reference_id=sale,
                )
            ],
            user_id=tenant.owner_id,
        )

    balance = await db.scalar(
        select(InventoryBalance.quantity).where(InventoryBalance.variant_id == variant)
    )
    assert balance == Decimal("-2")  # both sales kept; nothing overwritten
    flags = list(await db.scalars(select(ReviewFlag)))
    assert len(flags) == 1  # one open flag per item/location...
    flag = flags[0]
    assert flag.flag_type == "NEGATIVE_INVENTORY"
    assert flag.occurrences == 1  # only the second sale crossed below zero
    assert flag.details["references"] == [str(sale_b)]
    assert flag.details["balance"] == "-2.000"

    # A third oversell bumps the same flag and appends its reference.
    sale_c = uuid.uuid4()
    await post_movements(
        db,
        tenant.company_id,
        [
            MovementSpec(
                id=derived_id(sale_c, "SALE"),
                variant_id=variant,
                stock_location_id=location,
                quantity=Decimal(1),
                movement_type=MovementType.SALE,
                reference_type="sale",
                reference_id=sale_c,
            )
        ],
        user_id=None,
    )
    await db.refresh(flag)
    assert flag.occurrences == 2
    assert flag.details["references"] == [str(sale_b), str(sale_c)]
    assert flag.details["balance"] == "-3.000"
    assert await verify_balances(db, tenant.company_id) == []


async def test_reposting_same_movement_is_idempotent(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers)
    variant = uuid.UUID(product["variants"][0]["id"])
    location = uuid.UUID(await default_location(client, tenant.headers, tenant.branch_id))
    spec = MovementSpec(
        id=derived_id(uuid.uuid4(), "SALE"),
        variant_id=variant,
        stock_location_id=location,
        quantity=Decimal(2),
        movement_type=MovementType.SALE,
    )
    first = await post_movements(db, tenant.company_id, [spec], user_id=None)
    second = await post_movements(db, tenant.company_id, [spec], user_id=None)
    assert len(first.movements) == 1
    assert second.movements == []
    balance = await db.scalar(
        select(InventoryBalance.quantity).where(InventoryBalance.variant_id == variant)
    )
    assert balance == Decimal(-2)


async def test_untracked_products_post_nothing(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    service_item = await create_product(
        client, tenant.headers, name="Gift wrapping", barcode=None, track_inventory=False
    )
    location = uuid.UUID(await default_location(client, tenant.headers, tenant.branch_id))
    result = await post_movements(
        db,
        tenant.company_id,
        [
            MovementSpec(
                variant_id=uuid.UUID(service_item["variants"][0]["id"]),
                stock_location_id=location,
                quantity=Decimal(1),
                movement_type=MovementType.SALE,
            )
        ],
        user_id=None,
    )
    assert result.movements == [] and result.skipped_untracked == 1


async def test_review_flag_resolution(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers)
    location = uuid.UUID(await default_location(client, tenant.headers, tenant.branch_id))
    await post_movements(
        db,
        tenant.company_id,
        [
            MovementSpec(
                variant_id=uuid.UUID(product["variants"][0]["id"]),
                stock_location_id=location,
                quantity=Decimal(1),
                movement_type=MovementType.SALE,
            )
        ],
        user_id=None,
    )
    flags = (await client.get("/api/v1/review-flags", headers=tenant.headers)).json()
    assert flags["total"] == 1
    flag_id = flags["items"][0]["id"]
    resp = await client.post(
        f"/api/v1/review-flags/{flag_id}/resolve",
        json={"status": "RESOLVED", "note": "Counted; corrected with stock count"},
        headers=tenant.headers,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "RESOLVED"
    open_flags = (await client.get("/api/v1/review-flags", headers=tenant.headers)).json()
    assert open_flags["total"] == 0


async def test_negative_and_low_stock_filters(client: AsyncClient) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers, extra={})
    variant = product["variants"][0]["id"]
    await client.patch(
        f"/api/v1/variants/{variant}", json={"reorder_point": "10"}, headers=tenant.headers
    )
    location = await default_location(client, tenant.headers, tenant.branch_id)
    await _stock(client, tenant.headers, location, variant, "5")
    low = (
        await client.get(
            "/api/v1/inventory/balances", params={"low_stock": True}, headers=tenant.headers
        )
    ).json()
    assert low["total"] == 1
    negative = (
        await client.get(
            "/api/v1/inventory/balances", params={"negative": True}, headers=tenant.headers
        )
    ).json()
    assert negative["total"] == 0
