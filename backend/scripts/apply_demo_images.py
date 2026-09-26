"""Attach generated assets only to DEMO products that have no image.

Run from backend: python -m scripts.apply_demo_images ../assets/demo-products
"""

import asyncio
import json
import sys
from pathlib import Path

from sqlalchemy import select

from app import models  # noqa: F401
from app.core.database import get_engine, get_sessionmaker
from app.modules.audit.service import AuditActor
from app.modules.auth.principal import Principal
from app.modules.companies.models import Company
from app.modules.products.images import set_product_image
from app.modules.products.models import Product
from app.modules.storefront.cache import invalidate
from app.modules.users.models import User
from app.modules.users.permissions import P


async def main(folder: Path) -> None:
    manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    async with get_sessionmaker()() as db:
        company = (await db.scalars(select(Company).where(Company.code == "DEMO"))).one()
        owner = (
            await db.scalars(
                select(User).where(
                    User.company_id == company.id, User.email == "owner@demo.example.com"
                )
            )
        ).one()
        principal = Principal(
            user_id=owner.id,
            company_id=company.id,
            username=owner.username,
            global_permissions=frozenset({P.PRODUCTS_WRITE}),
        )
        actor = AuditActor(company_id=company.id, user_id=owner.id)
        pending = []
        for item in manifest["items"]:
            product = (
                await db.scalars(
                    select(Product).where(
                        Product.company_id == company.id, Product.name == item["name"]
                    )
                )
            ).one_or_none()
            if product is None:
                print(f"Missing: {item['name']}")
                continue
            if product.image_url:
                print(f"Already has image: {item['name']}")
                continue
            pending.append((product.id, item["name"], (folder / item["file"]).read_bytes()))
        for product_id, name, data in pending:
            await set_product_image(db, principal, product_id, data, actor)
            print(f"Attached: {name}")
        await invalidate(principal.company_id)
    await get_engine().dispose()


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1]).resolve()))
