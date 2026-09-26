from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.audit.models import AuditLog
from app.modules.auth.models import RefreshToken
from app.modules.users.permissions import P
from tests.helpers import DEFAULT_PASSWORD, auth, signup


async def test_signup_creates_tenant_with_owner(client: AsyncClient) -> None:
    tenant = await signup(client)
    resp = await client.get("/api/v1/auth/me", headers=tenant.headers)
    assert resp.status_code == 200
    me = resp.json()
    assert me["company"]["code"] == "ACME"
    assert set(me["permissions"]) == {p.value for p in P}

    branch = (
        await client.get(f"/api/v1/branches/{tenant.branch_id}", headers=tenant.headers)
    ).json()
    assert branch["code"] == "MAIN"
    assert [loc["is_default"] for loc in branch["locations"]] == [True]

    roles = (await client.get("/api/v1/roles", headers=tenant.headers)).json()
    assert {r["code"] for r in roles} >= {"OWNER", "MANAGER", "CASHIER"}


async def test_signup_rejects_duplicate_code_and_email(client: AsyncClient) -> None:
    await signup(client, "ACME")
    resp = await client.post(
        "/api/v1/companies/signup",
        json={
            "company_name": "Other",
            "company_code": "ACME",
            "owner_full_name": "X Y",
            "owner_email": "other@x.example.com",
            "owner_username": "owner",
            "owner_password": DEFAULT_PASSWORD,
        },
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "company.code_taken"


async def test_login_failure_is_generic_and_audited(client: AsyncClient, db: AsyncSession) -> None:
    tenant = await signup(client)
    for email in (tenant.email, "nobody@nowhere.example.org"):
        resp = await client.post(
            "/api/v1/auth/login", json={"email": email, "password": "wrong-password"}
        )
        assert resp.status_code == 401
        assert resp.json()["error"]["code"] == "auth.invalid_credentials"
    failures = await db.scalars(select(AuditLog).where(AuditLog.action == "auth.login_failed"))
    assert len(list(failures)) == 2


async def test_protected_endpoint_requires_token(client: AsyncClient) -> None:
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    assert (await client.get("/api/v1/auth/me", headers=auth("garbage"))).status_code == 401


async def test_refresh_rotates_token(client: AsyncClient) -> None:
    tenant = await signup(client)
    first_cookie = client.cookies.get("rt_admin")
    assert first_cookie

    resp = await client.post("/api/v1/auth/refresh", json={"client": "admin"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["access_token"]
    assert client.cookies.get("rt_admin") != first_cookie
    assert resp.json()["user"]["id"] == str(tenant.owner_id)


async def test_refresh_requires_csrf_header(client: AsyncClient) -> None:
    await signup(client)
    resp = await client.post(
        "/api/v1/auth/refresh", json={"client": "admin"}, headers={"X-Requested-With": ""}
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "auth.csrf"


async def test_refresh_token_reuse_revokes_family(client: AsyncClient, db: AsyncSession) -> None:
    await signup(client)
    stolen = client.cookies.get("rt_admin")
    assert (await client.post("/api/v1/auth/refresh", json={"client": "admin"})).status_code == 200
    legit = client.cookies.get("rt_admin")

    # Move the rotation outside the grace window, then replay the old (stolen) token.
    await db.execute(
        update(RefreshToken)
        .where(RefreshToken.revoked_at.is_not(None))
        .values(revoked_at=datetime.now(UTC) - timedelta(minutes=5))
    )
    client.cookies.set("rt_admin", stolen, path="/api/v1/auth")
    resp = await client.post("/api/v1/auth/refresh", json={"client": "admin"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "auth.refresh_reused"

    # The legitimate successor is now revoked too.
    client.cookies.set("rt_admin", legit, path="/api/v1/auth")
    resp = await client.post("/api/v1/auth/refresh", json={"client": "admin"})
    assert resp.status_code == 401


async def test_refresh_race_within_grace_gets_a_fresh_session(client: AsyncClient) -> None:
    """A reload aborted the refresh response, so the browser still holds the old token."""
    await signup(client)
    old = client.cookies.get("rt_admin")
    assert (await client.post("/api/v1/auth/refresh", json={"client": "admin"})).status_code == 200
    rotated = client.cookies.get("rt_admin")

    client.cookies.clear()
    client.cookies.set("rt_admin", old, path="/api/v1/auth")  # the lost response
    resp = await client.post("/api/v1/auth/refresh", json={"client": "admin"})
    assert resp.status_code == 200, resp.text
    newest = resp.cookies.get("rt_admin")
    assert newest and newest not in (old, rotated)

    # The session continues normally from the newest token.
    client.cookies.clear()
    client.cookies.set("rt_admin", newest, path="/api/v1/auth")
    assert (await client.post("/api/v1/auth/refresh", json={"client": "admin"})).status_code == 200


async def test_refresh_race_after_logout_is_refused(client: AsyncClient) -> None:
    await signup(client)
    old = client.cookies.get("rt_admin")
    assert (await client.post("/api/v1/auth/refresh", json={"client": "admin"})).status_code == 200
    assert (await client.post("/api/v1/auth/logout", json={"client": "admin"})).status_code == 204
    client.cookies.clear()
    client.cookies.set("rt_admin", old, path="/api/v1/auth")
    resp = await client.post("/api/v1/auth/refresh", json={"client": "admin"})
    assert resp.status_code == 401


async def test_logout_revokes_session(client: AsyncClient) -> None:
    await signup(client)
    token = client.cookies.get("rt_admin")
    assert (await client.post("/api/v1/auth/logout", json={"client": "admin"})).status_code == 204
    client.cookies.set("rt_admin", token, path="/api/v1/auth")
    assert (await client.post("/api/v1/auth/refresh", json={"client": "admin"})).status_code == 401


async def test_change_password(client: AsyncClient) -> None:
    tenant = await signup(client)
    resp = await client.post(
        "/api/v1/auth/me/password",
        json={"current_password": DEFAULT_PASSWORD, "new_password": "a-brand-new-password"},
        headers=tenant.headers,
    )
    assert resp.status_code == 204
    resp = await client.post(
        "/api/v1/auth/login", json={"email": tenant.email, "password": "a-brand-new-password"}
    )
    assert resp.status_code == 200


async def test_weak_pin_rejected(client: AsyncClient) -> None:
    tenant = await signup(client)
    resp = await client.put(
        "/api/v1/auth/me/pin",
        json={"current_password": DEFAULT_PASSWORD, "pin": "123456"},
        headers=tenant.headers,
    )
    assert resp.status_code == 422
    assert resp.json()["error"]["code"] == "user.weak_pin"


async def test_login_rate_limited(client: AsyncClient) -> None:
    tenant = await signup(client)
    codes = []
    for _ in range(6):
        resp = await client.post(
            "/api/v1/auth/login", json={"email": tenant.email, "password": "wrong-password"}
        )
        codes.append(resp.status_code)
    # signup's own login counted as 1; 5 per minute per email allowed.
    assert codes[-1] == 429
