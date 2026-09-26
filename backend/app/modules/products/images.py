"""Product photos.

Photos are stored on disk under `MEDIA_ROOT` and served by the API at `/api/v1/media/...`
(same origin as the app, behind the same reverse proxy). The browser resizes photos before
upload, so the server only validates them: real image bytes (magic numbers, not the declared
content type), allowed formats, size limit. File names contain a fresh UUID, so a replaced
photo gets a new URL and caches never show the old one.
"""

import asyncio
import uuid
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.audit import service as audit
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.products.models import Product
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.exceptions import BusinessRuleError
from app.shared.ids import new_id

MAX_IMAGE_BYTES = 2 * 1024 * 1024


def detect_image_type(data: bytes) -> str | None:
    """File extension for JPEG/PNG/WebP content, judged by the bytes themselves."""
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def _media_root() -> Path:
    return Path(get_settings().media_root)


def _url_for(relative: Path) -> str:
    return f"{get_settings().api_prefix}/media/{relative.as_posix()}"


def _path_for(url: str | None) -> Path | None:
    """Disk path of a photo previously stored by us (None for external/empty URLs)."""
    prefix = f"{get_settings().api_prefix}/media/"
    if not url or not url.startswith(prefix):
        return None
    relative = Path(url.removeprefix(prefix))
    if ".." in relative.parts:
        return None
    return _media_root() / relative


async def set_product_image(
    db: AsyncSession, principal: Principal, product_id: uuid.UUID, data: bytes, actor: AuditActor
) -> Product:
    principal.require(P.PRODUCTS_WRITE)
    product = await crud.get_scoped(db, Product, principal.company_id, product_id, "product")
    if len(data) > MAX_IMAGE_BYTES:
        raise BusinessRuleError("Photo is larger than 2 MB", code="product.image_too_large")
    extension = detect_image_type(data)
    if extension is None:
        raise BusinessRuleError("Upload a JPEG, PNG or WebP photo", code="product.image_type")

    relative = Path("products") / str(principal.company_id) / f"{product.id}-{new_id()}.{extension}"
    target = _media_root() / relative
    await asyncio.to_thread(_write, target, data)

    old = _path_for(product.image_url)
    product.image_url = _url_for(relative)
    audit.record(
        db,
        actor,
        "product.image_set",
        entity_type="product",
        entity_id=product.id,
        metadata={"bytes": len(data), "type": extension},
    )
    await db.commit()
    if old is not None:
        await asyncio.to_thread(old.unlink, missing_ok=True)
    return product


async def remove_product_image(
    db: AsyncSession, principal: Principal, product_id: uuid.UUID, actor: AuditActor
) -> Product:
    principal.require(P.PRODUCTS_WRITE)
    product = await crud.get_scoped(db, Product, principal.company_id, product_id, "product")
    old = _path_for(product.image_url)
    product.image_url = None
    audit.record(db, actor, "product.image_removed", entity_type="product", entity_id=product.id)
    await db.commit()
    if old is not None:
        await asyncio.to_thread(old.unlink, missing_ok=True)
    return product


def _write(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
