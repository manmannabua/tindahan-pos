"""Sync performance benchmark (development database, never production).

    uv run python scripts/benchmark_sync.py --products 1000 --sales 500

Creates a throwaway company (code BENCH…), N products with barcodes/prices/stock, registers a
terminal, then measures:
  * a full initial download (paged pull), and
  * pushing S offline sales in batches of 100 (and re-pushing them: all must be DUPLICATE).
Runs the app in-process (httpx ASGI transport) against DATABASE_URL.
"""

import argparse
import asyncio
import os
import secrets
import time
from decimal import Decimal

os.environ.setdefault("RATE_LIMIT_ENABLED", "false")
os.environ.setdefault("REDIS_URL", "fakeredis://")

from httpx import ASGITransport, AsyncClient
from uuid_utils.compat import uuid7

from app.core.config import get_settings
from app.main import app
from tests.helpers import Tenant, signup
from tests.sync_helpers import Item, make_terminal


async def seed(client: AsyncClient, tenant: Tenant, count: int) -> list[Item]:
    units = {
        u["code"]: u["id"]
        for u in (await client.get("/api/v1/units", headers=tenant.headers)).json()
    }
    branch = (
        await client.get(f"/api/v1/branches/{tenant.branch_id}", headers=tenant.headers)
    ).json()
    location = next(loc["id"] for loc in branch["locations"] if loc["is_default"])
    items: list[Item] = []
    stock_lines = []
    for n in range(count):
        price = Decimal(10 + n % 90) + Decimal("0.75")
        resp = await client.post(
            "/api/v1/products",
            json={
                "name": f"Bench product {n:05d}",
                "base_unit_id": units["PC"],
                "variants": [
                    {
                        "sku": f"B{n:06d}",
                        "cost": "5",
                        "barcodes": [{"code": f"BENCH{n:07d}"}],
                        "prices": [{"price": str(price)}],
                    }
                ],
            },
            headers=tenant.headers,
        )
        product = resp.json()
        variant = product["variants"][0]
        base_unit = next(u for u in product["units"] if u["is_base"])
        items.append(Item(variant["id"], base_unit["id"], price, product["name"], variant["sku"]))
        stock_lines.append({"variant_id": variant["id"], "quantity": "1000"})
    for i in range(0, len(stock_lines), 1000):
        await client.post(
            "/api/v1/inventory/initial-stock",
            json={"stock_location_id": location, "lines": stock_lines[i : i + 1000]},
            headers=tenant.headers,
        )
    return items


async def main(products: int, sales: int) -> None:
    print(f"Database: {get_settings().database_url}")
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://bench",
        headers={"X-Requested-With": "pos"},
        timeout=120,
    ) as client:
        code = "BENCH" + secrets.token_hex(3).upper()
        tenant = await signup(client, code, email=f"owner@{code.lower()}.example.com")
        t0 = time.perf_counter()
        items = await seed(client, tenant, products)
        print(f"Seeded {products} products in {time.perf_counter() - t0:.1f}s")

        terminal = await make_terminal(client, tenant)
        t0 = time.perf_counter()
        cursor, pages, rows = None, 0, 0
        while True:
            params = {"limit": 2000, **({"cursor": cursor} if cursor else {})}
            page = (
                await client.get("/api/v1/sync/pull", params=params, headers=terminal.headers)
            ).json()
            pages += 1
            rows += sum(len(v) for v in page["changes"].values())
            cursor = page["next_cursor"]
            if not page["has_more"]:
                break
        pull_s = time.perf_counter() - t0
        print(
            f"Initial download: {rows} rows in {pages} pages, {pull_s:.2f}s ({rows / pull_s:.0f} rows/s)"
        )

        ops = [terminal.open_session()]
        for n in range(sales):
            basket = [(items[(n * 7 + k) % len(items)], str(1 + k % 3)) for k in range(3)]
            ops.append(terminal.sale(basket, tendered="10000.00"))
        t0 = time.perf_counter()
        for i in range(0, len(ops), 100):
            results = await terminal.push(ops[i : i + 100])
            assert all(r["status"] == "APPLIED" for r in results), results[:3]
        push_s = time.perf_counter() - t0
        print(f"Push: {sales} sales (3 lines each) in {push_s:.2f}s ({sales / push_s:.1f} sales/s)")

        t0 = time.perf_counter()
        for i in range(0, len(ops), 100):
            results = await terminal.push(ops[i : i + 100])
            assert all(r["status"] == "DUPLICATE" for r in results)
        print(f"Re-push (all DUPLICATE): {time.perf_counter() - t0:.2f}s")

        t0 = time.perf_counter()
        summary = (await client.get("/api/v1/reports/sales-summary", headers=tenant.headers)).json()
        print(
            f"sales-summary: {summary['data']['transactions']} transactions in "
            f"{(time.perf_counter() - t0) * 1000:.0f} ms"
        )
        print(f"Company code: {code} (throwaway data in the dev database) {uuid7()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--products", type=int, default=1000)
    parser.add_argument("--sales", type=int, default=500)
    args = parser.parse_args()
    asyncio.run(main(args.products, args.sales))
