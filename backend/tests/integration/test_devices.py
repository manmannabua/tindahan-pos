import uuid

from httpx import AsyncClient

from app.core.security import device_challenge_message
from tests.helpers import (
    auth,
    create_user,
    device_token,
    login,
    new_device_key,
    register_device,
    sign_webcrypto_style,
    signup,
    spki_b64,
)


async def test_register_and_authenticate_device(client: AsyncClient) -> None:
    tenant = await signup(client)
    device, key = await register_device(client, tenant.headers, tenant.branch_id)
    assert device["status"] == "ACTIVE"

    token = await device_token(client, device["id"], key)
    me = await client.get("/api/v1/devices/me", headers=auth(token))
    assert me.status_code == 200
    assert me.json()["terminal_code"] == "T01"

    # A device token is not a user token.
    assert (await client.get("/api/v1/auth/me", headers=auth(token))).status_code == 401


async def test_challenge_is_single_use(client: AsyncClient) -> None:
    tenant = await signup(client)
    device, key = await register_device(client, tenant.headers, tenant.branch_id)
    nonce = (await client.post(f"/api/v1/devices/{device['id']}/challenge")).json()["nonce"]
    body = {
        "device_id": device["id"],
        "nonce": nonce,
        "signature": sign_webcrypto_style(
            key, device_challenge_message(uuid.UUID(device["id"]), nonce)
        ),
    }
    assert (await client.post("/api/v1/devices/token", json=body)).status_code == 200
    replay = await client.post("/api/v1/devices/token", json=body)
    assert replay.status_code == 401
    assert replay.json()["error"]["code"] == "device.challenge_invalid"


async def test_wrong_key_cannot_authenticate(client: AsyncClient) -> None:
    tenant = await signup(client)
    device, _ = await register_device(client, tenant.headers, tenant.branch_id)
    attacker = new_device_key()
    nonce = (await client.post(f"/api/v1/devices/{device['id']}/challenge")).json()["nonce"]
    resp = await client.post(
        "/api/v1/devices/token",
        json={
            "device_id": device["id"],
            "nonce": nonce,
            "signature": sign_webcrypto_style(
                attacker, device_challenge_message(uuid.UUID(device["id"]), nonce)
            ),
        },
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "device.bad_signature"


async def test_terminal_code_unique_per_branch_until_revoked(client: AsyncClient) -> None:
    tenant = await signup(client)
    device, _ = await register_device(client, tenant.headers, tenant.branch_id, "T01")
    resp = await client.post(
        "/api/v1/devices/register",
        json={
            "branch_id": str(tenant.branch_id),
            "terminal_code": "T01",
            "name": "Dup",
            "public_key": spki_b64(new_device_key()),
        },
        headers=tenant.headers,
    )
    assert resp.status_code == 409

    revoke = await client.post(f"/api/v1/devices/{device['id']}/revoke", headers=tenant.headers)
    assert revoke.json()["status"] == "REVOKED"
    # Replacement terminal may reuse the code.
    await register_device(client, tenant.headers, tenant.branch_id, "T01")


async def test_pin_login_on_device(client: AsyncClient) -> None:
    tenant = await signup(client)
    await create_user(client, tenant.headers, username="cathy", role_code="CASHIER", pin="482915")
    device, key = await register_device(client, tenant.headers, tenant.branch_id)
    dev = auth(await device_token(client, device["id"], key))

    bad = await client.post(
        "/api/v1/auth/pin-login", json={"username": "cathy", "pin": "000001"}, headers=dev
    )
    assert bad.status_code == 401

    ok = await client.post(
        "/api/v1/auth/pin-login", json={"username": "cathy", "pin": "482915"}, headers=dev
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["user"]["device_id"] == device["id"]
    assert client.cookies.get("rt_pos")

    me = await client.get("/api/v1/auth/me", headers=auth(body["access_token"]))
    assert me.json()["username"] == "cathy"

    # PIN login requires a device token, not a user token.
    resp = await client.post(
        "/api/v1/auth/pin-login",
        json={"username": "cathy", "pin": "482915"},
        headers=tenant.headers,
    )
    assert resp.status_code == 401


async def test_pin_login_requires_pos_access_in_device_branch(client: AsyncClient) -> None:
    tenant = await signup(client)
    other = (
        await client.post(
            "/api/v1/branches", json={"code": "B2", "name": "Branch Two"}, headers=tenant.headers
        )
    ).json()
    # Cashier assigned only to branch B2; device is in MAIN.
    await create_user(
        client,
        tenant.headers,
        username="cathy",
        role_code="CASHIER",
        branch_id=uuid.UUID(other["id"]),
        pin="482915",
    )
    device, key = await register_device(client, tenant.headers, tenant.branch_id)
    dev = auth(await device_token(client, device["id"], key))
    resp = await client.post(
        "/api/v1/auth/pin-login", json={"username": "cathy", "pin": "482915"}, headers=dev
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "auth.no_pos_access"


async def test_revoked_device_is_locked_out(client: AsyncClient) -> None:
    tenant = await signup(client)
    await create_user(client, tenant.headers, username="cathy", role_code="CASHIER", pin="482915")
    device, key = await register_device(client, tenant.headers, tenant.branch_id)
    dev_token = await device_token(client, device["id"], key)
    pos = await client.post(
        "/api/v1/auth/pin-login",
        json={"username": "cathy", "pin": "482915"},
        headers=auth(dev_token),
    )
    user_on_device = auth(pos.json()["access_token"])

    await client.post(f"/api/v1/devices/{device['id']}/revoke", headers=tenant.headers)

    assert (await client.get("/api/v1/devices/me", headers=auth(dev_token))).status_code == 401
    # User tokens bound to the device die with it.
    assert (await client.get("/api/v1/auth/me", headers=user_on_device)).status_code == 401
    # And it can't get a new device token.
    assert (await client.post(f"/api/v1/devices/{device['id']}/challenge")).status_code == 404


async def test_cashier_cannot_register_device(client: AsyncClient) -> None:
    tenant = await signup(client)
    await create_user(client, tenant.headers, username="cathy", role_code="CASHIER")
    cashier = auth(await login(client, "cathy@example.com"))
    resp = await client.post(
        "/api/v1/devices/register",
        json={
            "branch_id": str(tenant.branch_id),
            "terminal_code": "T09",
            "name": "Sneaky",
            "public_key": spki_b64(new_device_key()),
        },
        headers=cashier,
    )
    assert resp.status_code == 403
