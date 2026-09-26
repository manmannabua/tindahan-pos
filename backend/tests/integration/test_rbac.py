from httpx import AsyncClient

from tests.helpers import auth, create_user, login, role_id, signup


async def test_cashier_cannot_manage_branches(client: AsyncClient) -> None:
    tenant = await signup(client)
    await create_user(client, tenant.headers, username="cathy", role_code="CASHIER")
    cashier = auth(await login(client, "cathy@example.com"))

    resp = await client.post(
        "/api/v1/branches", json={"code": "B2", "name": "Branch Two"}, headers=cashier
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "permission_denied"
    assert (await client.get("/api/v1/users", headers=cashier)).status_code == 403


async def test_branch_scoped_role_only_applies_to_its_branch(client: AsyncClient) -> None:
    tenant = await signup(client)
    other = (
        await client.post(
            "/api/v1/branches", json={"code": "B2", "name": "Branch Two"}, headers=tenant.headers
        )
    ).json()

    # A custom role with branches.manage, assigned only for the MAIN branch.
    resp = await client.post(
        "/api/v1/roles",
        json={"code": "BRANCH_ADMIN", "name": "Branch admin", "permissions": ["branches.manage"]},
        headers=tenant.headers,
    )
    assert resp.status_code == 201
    resp = await client.post(
        "/api/v1/users",
        json={
            "email": "bea@example.com",
            "username": "bea",
            "full_name": "Bea",
            "password": "correct-horse-battery",
            "roles": [{"role_id": resp.json()["id"], "branch_id": str(tenant.branch_id)}],
        },
        headers=tenant.headers,
    )
    assert resp.status_code == 201
    bea = auth(await login(client, "bea@example.com"))

    own = await client.patch(
        f"/api/v1/branches/{tenant.branch_id}", json={"phone": "0917"}, headers=bea
    )
    assert own.status_code == 200
    assert own.json()["phone"] == "0917"

    foreign = await client.patch(
        f"/api/v1/branches/{other['id']}", json={"phone": "x"}, headers=bea
    )
    assert foreign.status_code == 403


async def test_manager_cannot_escalate_to_owner(client: AsyncClient) -> None:
    tenant = await signup(client)
    await create_user(client, tenant.headers, username="max", role_code="MANAGER")
    # Give the manager users.manage via a custom role so the escalation check is what stops them.
    resp = await client.post(
        "/api/v1/roles",
        json={"code": "HR", "name": "HR", "permissions": ["users.manage"]},
        headers=tenant.headers,
    )
    hr_role = resp.json()["id"]
    users = (await client.get("/api/v1/users", params={"q": "max"}, headers=tenant.headers)).json()
    max_id = users["items"][0]["id"]
    resp = await client.put(
        f"/api/v1/users/{max_id}/roles",
        json={
            "roles": [
                {"role_id": await role_id(client, tenant.headers, "MANAGER")},
                {"role_id": hr_role},
            ]
        },
        headers=tenant.headers,
    )
    assert resp.status_code == 200, resp.text
    manager = auth(await login(client, "max@example.com"))

    resp = await client.post(
        "/api/v1/users",
        json={
            "email": "evil@example.com",
            "username": "evil",
            "full_name": "Evil",
            "password": "correct-horse-battery",
            "roles": [{"role_id": await role_id(client, tenant.headers, "OWNER")}],
        },
        headers=manager,
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "role.escalation"

    # ...and cannot demote the owner either.
    resp = await client.put(
        f"/api/v1/users/{tenant.owner_id}/roles",
        json={"roles": [{"role_id": await role_id(client, tenant.headers, "CASHIER")}]},
        headers=manager,
    )
    assert resp.status_code == 403


async def test_cannot_change_own_roles_or_deactivate_self(client: AsyncClient) -> None:
    tenant = await signup(client)
    resp = await client.put(
        f"/api/v1/users/{tenant.owner_id}/roles",
        json={"roles": [{"role_id": await role_id(client, tenant.headers, "CASHIER")}]},
        headers=tenant.headers,
    )
    assert resp.status_code == 422
    resp = await client.patch(
        f"/api/v1/users/{tenant.owner_id}", json={"is_active": False}, headers=tenant.headers
    )
    assert resp.status_code == 422


async def test_deactivated_user_loses_access_immediately(client: AsyncClient) -> None:
    tenant = await signup(client)
    user = await create_user(client, tenant.headers, username="dan", role_code="CASHIER")
    dan = auth(await login(client, "dan@example.com"))
    assert (await client.get("/api/v1/auth/me", headers=dan)).status_code == 200

    resp = await client.patch(
        f"/api/v1/users/{user['id']}", json={"is_active": False}, headers=tenant.headers
    )
    assert resp.status_code == 200
    # Existing access token stops working because the user is checked on every request.
    assert (await client.get("/api/v1/auth/me", headers=dan)).status_code == 401


async def test_tenant_isolation(client: AsyncClient) -> None:
    a = await signup(client, "ACME")
    b = await signup(client, "BETA")
    # B cannot see A's branch — and gets 404, not 403, so existence isn't revealed.
    resp = await client.get(f"/api/v1/branches/{a.branch_id}", headers=b.headers)
    assert resp.status_code == 404
    resp = await client.get(f"/api/v1/users/{a.owner_id}", headers=b.headers)
    assert resp.status_code == 404
    branches = (await client.get("/api/v1/branches", headers=b.headers)).json()
    assert [br["id"] for br in branches] == [str(b.branch_id)]


async def test_system_role_rules(client: AsyncClient) -> None:
    tenant = await signup(client)
    owner_role = await role_id(client, tenant.headers, "OWNER")
    resp = await client.patch(
        f"/api/v1/roles/{owner_role}", json={"permissions": []}, headers=tenant.headers
    )
    assert resp.status_code == 422
    resp = await client.delete(
        f"/api/v1/roles/{await role_id(client, tenant.headers, 'CASHIER')}", headers=tenant.headers
    )
    assert resp.status_code == 422
