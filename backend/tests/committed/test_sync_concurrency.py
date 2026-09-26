"""Idempotency under real concurrency: the retry that fires while the first request is still
running (docs/SYNC_PROTOCOL.md §3, "Why this is safe under concurrency")."""

import asyncio

from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.inventory.models import InventoryBalance
from app.modules.payments.models import Payment
from app.modules.sales.models import Sale
from tests.helpers import signup
from tests.sync_helpers import make_terminal, stocked_item


async def test_same_batch_pushed_concurrently_applies_once(
    committed_client: AsyncClient, cdb: AsyncSession, company_code: str
) -> None:
    client = committed_client
    tenant = await signup(client, company_code)
    item = await stocked_item(client, tenant, stock="100")
    terminal = await make_terminal(client, tenant)
    await terminal.push([terminal.open_session()])
    batch = [terminal.sale([(item, "1")]) for _ in range(10)]

    results = await asyncio.gather(*(terminal.push(batch) for _ in range(4)))

    for position in range(10):
        statuses = sorted(r[position]["status"] for r in results)
        # Exactly one request applied each sale; the others saw it as done (or asked to retry).
        assert statuses.count("APPLIED") == 1, statuses
        assert set(statuses) <= {"APPLIED", "DUPLICATE", "RETRY"}

    sales = await cdb.scalar(
        select(func.count()).select_from(Sale).where(Sale.device_id == terminal.device["id"])
    )
    payments = await cdb.scalar(
        select(func.count())
        .select_from(Payment)
        .join(Sale, Sale.id == Payment.sale_id)
        .where(Sale.device_id == terminal.device["id"])
    )
    balance = await cdb.scalar(
        select(InventoryBalance.quantity).where(InventoryBalance.variant_id == item.variant_id)
    )
    assert (sales, payments, int(balance or 0)) == (10, 10, 90)
