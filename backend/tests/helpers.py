"""Test helpers that drive the API like a real client would."""

import base64
import uuid
from dataclasses import dataclass
from typing import Any

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from httpx import AsyncClient

from app.core.security import device_challenge_message

DEFAULT_PASSWORD = "correct-horse-battery"


@dataclass
class Tenant:
    company_id: uuid.UUID
    branch_id: uuid.UUID
    owner_id: uuid.UUID
    token: str
    email: str

    @property
    def headers(self) -> dict[str, str]:
        return auth(self.token)


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def signup(client: AsyncClient, code: str = "ACME", email: str | None = None) -> Tenant:
    email = email or f"owner@{code.lower()}.example.com"
    resp = await client.post(
        "/api/v1/companies/signup",
        json={
            "company_name": f"{code} Trading",
            "company_code": code,
            "owner_full_name": "Olivia Owner",
            "owner_email": email,
            "owner_username": "owner",
            "owner_password": DEFAULT_PASSWORD,
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    token = await login(client, email)
    return Tenant(
        company_id=uuid.UUID(body["company"]["id"]),
        branch_id=uuid.UUID(body["branch_id"]),
        owner_id=uuid.UUID(body["owner_user_id"]),
        token=token,
        email=email,
    )


async def login(client: AsyncClient, email: str, password: str = DEFAULT_PASSWORD) -> str:
    resp = await client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return str(resp.json()["access_token"])


async def role_id(client: AsyncClient, headers: dict[str, str], code: str) -> str:
    resp = await client.get("/api/v1/roles", headers=headers)
    assert resp.status_code == 200, resp.text
    return next(r["id"] for r in resp.json() if r["code"] == code)


async def create_user(
    client: AsyncClient,
    headers: dict[str, str],
    *,
    username: str,
    role_code: str,
    branch_id: uuid.UUID | None = None,
    pin: str | None = None,
    email: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "email": email or f"{username}@example.com",
        "username": username,
        "full_name": username.title(),
        "password": DEFAULT_PASSWORD,
        "roles": [
            {
                "role_id": await role_id(client, headers, role_code),
                "branch_id": str(branch_id) if branch_id else None,
            }
        ],
    }
    if pin:
        payload["pin"] = pin
    resp = await client.post("/api/v1/users", json=payload, headers=headers)
    assert resp.status_code == 201, resp.text
    return dict(resp.json())


def new_device_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


def spki_b64(key: ec.EllipticCurvePrivateKey) -> str:
    der = key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    return base64.b64encode(der).decode()


def sign_webcrypto_style(key: ec.EllipticCurvePrivateKey, message: bytes) -> str:
    """Sign and encode as IEEE P1363 (raw r||s), which is what WebCrypto produces."""
    r, s = decode_dss_signature(key.sign(message, ec.ECDSA(hashes.SHA256())))
    return base64.b64encode(r.to_bytes(32, "big") + s.to_bytes(32, "big")).decode()


async def register_device(
    client: AsyncClient,
    headers: dict[str, str],
    branch_id: uuid.UUID,
    terminal_code: str = "T01",
) -> tuple[dict[str, Any], ec.EllipticCurvePrivateKey]:
    key = new_device_key()
    resp = await client.post(
        "/api/v1/devices/register",
        json={
            "branch_id": str(branch_id),
            "terminal_code": terminal_code,
            "name": f"Counter {terminal_code}",
            "platform": "pytest",
            "public_key": spki_b64(key),
        },
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return dict(resp.json()), key


async def device_token(client: AsyncClient, device_id: str, key: ec.EllipticCurvePrivateKey) -> str:
    resp = await client.post(f"/api/v1/devices/{device_id}/challenge")
    assert resp.status_code == 200, resp.text
    nonce = resp.json()["nonce"]
    signature = sign_webcrypto_style(key, device_challenge_message(uuid.UUID(device_id), nonce))
    resp = await client.post(
        "/api/v1/devices/token",
        json={"device_id": device_id, "nonce": nonce, "signature": signature},
    )
    assert resp.status_code == 200, resp.text
    return str(resp.json()["access_token"])
