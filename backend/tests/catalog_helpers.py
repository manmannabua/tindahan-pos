"""Helpers for catalog/inventory tests."""

from typing import Any

from httpx import AsyncClient


async def ref_ids(client: AsyncClient, headers: dict[str, str]) -> dict[str, str]:
    """Map of seeded reference codes to ids: units, tax rates, price levels."""
    ids: dict[str, str] = {}
    for path in ("/api/v1/units", "/api/v1/tax-rates", "/api/v1/price-levels"):
        resp = await client.get(path, headers=headers)
        assert resp.status_code == 200, resp.text
        ids.update({row["code"]: row["id"] for row in resp.json()})
    return ids


async def create_product(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    name: str = "Coke 1.5L",
    barcode: str | None = "4800361419117",
    price: str = "75.00",
    cost: str | None = "60.0000",
    track_inventory: bool = True,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    ids = await ref_ids(client, headers)
    variant: dict[str, Any] = {"prices": [{"price": price}]}
    if barcode:
        variant["barcodes"] = [{"code": barcode, "is_primary": True}]
    if cost:
        variant["cost"] = cost
    body: dict[str, Any] = {
        "name": name,
        "base_unit_id": ids["PC"],
        "track_inventory": track_inventory,
        "variants": [variant],
        **(extra or {}),
    }
    resp = await client.post("/api/v1/products", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return dict(resp.json())


async def default_location(client: AsyncClient, headers: dict[str, str], branch_id: object) -> str:
    branch = (await client.get(f"/api/v1/branches/{branch_id}", headers=headers)).json()
    return str(next(loc["id"] for loc in branch["locations"] if loc["is_default"]))
