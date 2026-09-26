"""Database-level guarantees: triggers and constraints that the application relies on."""

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditLog
from app.modules.branches.models import Branch
from tests.helpers import signup


async def test_sync_txid_set_by_trigger(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    branch = await db.scalar(select(Branch).where(Branch.id == tenant.branch_id))
    assert branch is not None
    assert branch.sync_txid is not None
    current = await db.scalar(text("SELECT pg_current_xact_id()::text::bigint"))
    assert branch.sync_txid == current


async def test_audit_log_is_append_only(client: AsyncClient, db: AsyncSession) -> None:
    await signup(client)
    entry = await db.scalar(select(AuditLog).limit(1))
    assert entry is not None
    for statement in ("UPDATE audit_logs SET action = 'x'", "DELETE FROM audit_logs"):
        with pytest.raises(DBAPIError, match="append-only"):
            async with db.begin_nested():
                await db.execute(text(statement))


async def test_one_default_location_per_branch(client: AsyncClient) -> None:
    tenant = await signup(client)
    resp = await client.post(
        f"/api/v1/branches/{tenant.branch_id}/locations",
        json={"code": "WH", "name": "Warehouse", "location_type": "WAREHOUSE", "is_default": True},
        headers=tenant.headers,
    )
    assert resp.status_code == 201
    branch = (
        await client.get(f"/api/v1/branches/{tenant.branch_id}", headers=tenant.headers)
    ).json()
    defaults = [loc["code"] for loc in branch["locations"] if loc["is_default"]]
    assert defaults == ["WH"]


async def test_audit_log_listing(client: AsyncClient) -> None:
    tenant = await signup(client)
    for code in ("B2", "B3", "B4"):
        await client.post(
            "/api/v1/branches",
            json={"code": code, "name": f"Branch {code}"},
            headers=tenant.headers,
        )
    page1 = (
        await client.get(
            "/api/v1/audit-logs",
            params={"action": "branch.created", "limit": 2},
            headers=tenant.headers,
        )
    ).json()
    assert len(page1["items"]) == 2
    assert page1["next_cursor"]
    page2 = (
        await client.get(
            "/api/v1/audit-logs",
            params={"action": "branch.created", "limit": 2, "cursor": page1["next_cursor"]},
            headers=tenant.headers,
        )
    ).json()
    assert len(page2["items"]) == 1
    assert page2["next_cursor"] is None
