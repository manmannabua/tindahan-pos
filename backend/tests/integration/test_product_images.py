"""Product photo upload, replacement, serving and removal."""

import base64

from httpx import AsyncClient

from tests.catalog_helpers import create_product
from tests.helpers import auth, create_user, login, signup

# 1x1 transparent PNG
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
JPEG_HEADER = b"\xff\xd8\xff\xe0" + b"\x00" * 64


async def test_upload_replace_serve_and_remove(client: AsyncClient) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers)
    url = f"/api/v1/products/{product['id']}/image"

    resp = await client.put(
        url, files={"file": ("coke.png", PNG, "image/png")}, headers=tenant.headers
    )
    assert resp.status_code == 200, resp.text
    first = resp.json()["image_url"]
    assert first.startswith("/api/v1/media/products/") and first.endswith(".png")

    served = await client.get(first)
    assert served.status_code == 200 and served.content == PNG

    listing = (await client.get("/api/v1/products", headers=tenant.headers)).json()
    assert listing["items"][0]["image_url"] == first

    # Replacing gives a new URL and removes the old file.
    resp = await client.put(
        url, files={"file": ("coke.jpg", JPEG_HEADER, "image/jpeg")}, headers=tenant.headers
    )
    second = resp.json()["image_url"]
    assert second != first and second.endswith(".jpg")
    assert (await client.get(first)).status_code == 404

    resp = await client.delete(url, headers=tenant.headers)
    assert resp.json()["image_url"] is None
    assert (await client.get(second)).status_code == 404


async def test_rejects_non_images_and_large_files(client: AsyncClient) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers)
    url = f"/api/v1/products/{product['id']}/image"

    # Declared as PNG, but the bytes are not an image.
    resp = await client.put(
        url,
        files={"file": ("x.png", b"<script>alert(1)</script>", "image/png")},
        headers=tenant.headers,
    )
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "product.image_type"

    big = PNG + b"\x00" * (2 * 1024 * 1024)
    resp = await client.put(
        url, files={"file": ("big.png", big, "image/png")}, headers=tenant.headers
    )
    assert resp.status_code == 422 and resp.json()["error"]["code"] == "product.image_too_large"


async def test_cashier_cannot_upload(client: AsyncClient) -> None:
    tenant = await signup(client)
    product = await create_product(client, tenant.headers)
    await create_user(client, tenant.headers, username="cathy", role_code="CASHIER")
    cashier = auth(await login(client, "cathy@example.com"))
    resp = await client.put(
        f"/api/v1/products/{product['id']}/image",
        files={"file": ("x.png", PNG, "image/png")},
        headers=cashier,
    )
    assert resp.status_code == 403
