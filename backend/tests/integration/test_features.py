"""Optional features: owner switches, dependencies, gating of endpoints/reports, onboarding."""

from typing import Any

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from uuid_utils.compat import uuid7

from app.modules.audit.models import AuditLog
from app.modules.companies.features import Feature
from tests.helpers import Tenant, auth, create_user, login, signup
from tests.sync_helpers import make_terminal

FEATURES = "/api/v1/companies/current/features"


async def set_features(client: AsyncClient, tenant: Tenant, **features: bool) -> Any:
    return await client.put(FEATURES, json={"features": features}, headers=tenant.headers)


async def test_new_business_starts_onboarding_with_everything_on(client: AsyncClient) -> None:
    tenant = await signup(client)
    me = (await client.get("/api/v1/auth/me", headers=tenant.headers)).json()
    assert me["company"]["onboarding_completed"] is False
    assert me["company"]["features"] == {f.value: True for f in Feature}

    resp = await client.post(
        "/api/v1/companies/current/onboarding/complete", headers=tenant.headers
    )
    assert resp.status_code == 200 and resp.json()["onboarding_completed"] is True
    me = (await client.get("/api/v1/auth/me", headers=tenant.headers)).json()
    assert me["company"]["onboarding_completed"] is True


async def test_catalogue_of_features_and_presets(client: AsyncClient) -> None:
    tenant = await signup(client)
    body = (await client.get(FEATURES, headers=tenant.headers)).json()
    by_key = {f["key"]: f for f in body["features"]}
    assert set(by_key) == {f.value for f in Feature}
    assert by_key["purchasing"]["requires"] == ["inventory"]
    assert all(f["enabled"] for f in body["features"])
    presets = {p["key"]: set(p["features"]) for p in body["presets"]}
    assert set(presets) == {"basic", "standard", "everything"}
    assert "online_catalog" not in presets["standard"]
    assert presets["everything"] == set(by_key)


async def test_switching_off_blocks_the_feature_and_is_audited(
    client: AsyncClient, db: AsyncSession
) -> None:
    tenant = await signup(client)
    assert (await client.get("/api/v1/suppliers", headers=tenant.headers)).status_code == 200

    resp = await set_features(client, tenant, purchasing=False, expenses=False)
    assert resp.status_code == 200, resp.text
    state = {f["key"]: f["enabled"] for f in resp.json()["features"]}
    assert state["purchasing"] is False and state["inventory"] is True

    for path in ("/api/v1/suppliers", "/api/v1/purchase-orders", "/api/v1/expenses"):
        blocked = await client.get(path, headers=tenant.headers)
        assert blocked.status_code == 403, path
        assert blocked.json()["error"]["code"] == "feature.disabled"
    assert (await client.get("/api/v1/products", headers=tenant.headers)).status_code == 200

    assert (await set_features(client, tenant, purchasing=True)).status_code == 200
    assert (await client.get("/api/v1/suppliers", headers=tenant.headers)).status_code == 200

    changes = [
        e.changes
        for e in await db.scalars(
            select(AuditLog).where(AuditLog.action == "company.features_changed")
        )
    ]
    assert changes == [
        {"purchasing": [True, False], "expenses": [True, False]},
        {"purchasing": [False, True]},
    ]


async def test_dependencies_and_validation(client: AsyncClient) -> None:
    tenant = await signup(client)
    resp = await set_features(client, tenant, inventory=False)  # purchasing still on
    assert resp.status_code == 422
    assert resp.json()["error"]["details"] == {"feature": "purchasing", "requires": "inventory"}
    assert (
        await set_features(client, tenant, inventory=False, purchasing=False)
    ).status_code == 200
    # Purchasing can't come back without stock tracking.
    assert (await set_features(client, tenant, purchasing=True)).status_code == 422
    assert (await set_features(client, tenant, nonsense=True)).status_code == 422


async def test_only_owners_switch_features(client: AsyncClient) -> None:
    tenant = await signup(client)
    await create_user(client, tenant.headers, username="mgr", role_code="MANAGER")
    manager = auth(await login(client, "mgr@example.com"))
    assert (await client.get(FEATURES, headers=manager)).status_code == 200  # can see
    resp = await client.put(FEATURES, json={"features": {"expenses": False}}, headers=manager)
    assert resp.status_code == 403


async def test_reports_follow_features(client: AsyncClient) -> None:
    tenant = await signup(client)
    await set_features(client, tenant, sc_pwd=False, bir=False)
    names = {
        r["name"] for r in (await client.get("/api/v1/reports", headers=tenant.headers)).json()
    }
    assert "sales-summary" in names
    assert not {"sc-pwd-book", "terminal-reading"} & names
    resp = await client.get("/api/v1/reports/sc-pwd-book", headers=tenant.headers)
    assert resp.status_code == 403 and resp.json()["error"]["code"] == "feature.disabled"
    resp = await client.post("/api/v1/reports/terminal-reading/export", headers=tenant.headers)
    assert resp.status_code == 403


async def test_online_catalog_and_stock_follow_features(client: AsyncClient) -> None:
    tenant = await signup(client)
    body = {"slug": "acme", "enabled": True, "branch_ids": [str(tenant.branch_id)]}
    assert (
        await client.put("/api/v1/storefront", json=body, headers=tenant.headers)
    ).status_code == 200
    store = (await client.get("/api/v1/public/stores/acme")).json()
    assert store["stock_display"] == "AVAILABILITY"

    # A business that doesn't track stock never shows stock online.
    await set_features(client, tenant, purchasing=False, inventory=False)
    assert (await client.get("/api/v1/public/stores/acme")).json()["stock_display"] == "HIDDEN"

    await set_features(client, tenant, online_catalog=False)
    assert (await client.get("/api/v1/public/stores/acme")).status_code == 404
    assert (await client.get("/api/v1/storefront", headers=tenant.headers)).status_code == 403


async def test_terminals_learn_features_and_sync_is_never_blocked(client: AsyncClient) -> None:
    tenant = await signup(client)
    terminal = await make_terminal(client, tenant)
    await set_features(client, tenant, customers=False)

    context = (await client.get("/api/v1/sync/context", headers=terminal.headers)).json()
    assert context["features"]["customers"] is False and context["features"]["inventory"] is True

    # A customer created offline before the owner switched customers off is still accepted.
    op = terminal.op(
        "customer.upsert",
        "customer",
        {
            "id": str(uuid7()),
            "user_id": terminal.cashier_id,
            "name": "Juan dela Cruz",
            "phone": "09171234567",
        },
    )
    assert (await terminal.push([op]))[0]["status"] == "APPLIED"
