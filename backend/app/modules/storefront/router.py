import uuid
from collections.abc import Awaitable, Callable
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request, Response

from app.core.rate_limit import enforce_rate_limit
from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    client_ip,
    require_feature,
    require_permission,
)
from app.modules.companies.features import Feature
from app.modules.storefront import cache, public, service
from app.modules.storefront.schemas import (
    ProductsOnlineResult,
    ProductsOnlineUpdate,
    PublicProductDetail,
    PublicProductPage,
    PublicStore,
    StorefrontRead,
    StorefrontUpdate,
)
from app.modules.users.permissions import P

# ---------------------------------------------------------------- owner / admin

router = APIRouter(
    tags=["storefront"], dependencies=[Depends(require_feature(Feature.ONLINE_CATALOG))]
)


@router.get(
    "/storefront",
    response_model=StorefrontRead,
    dependencies=[Depends(require_permission(P.COMPANY_MANAGE))],
)
async def get_storefront(principal: CurrentPrincipal, db: DbSession) -> StorefrontRead:
    return await service.get_storefront(db, principal.company_id)


@router.put("/storefront", response_model=StorefrontRead)
async def save_storefront(
    data: StorefrontUpdate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> StorefrontRead:
    return await service.save_storefront(db, principal, data, audit_actor(principal, request))


@router.post("/products/show-online", response_model=ProductsOnlineResult)
async def set_products_online(
    data: ProductsOnlineUpdate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> ProductsOnlineResult:
    """Show or hide products in the online catalog: the given ids, or all matching a filter."""
    updated = await service.set_products_online(
        db, principal, data, audit_actor(principal, request)
    )
    return ProductsOnlineResult(updated=updated)


# ---------------------------------------------------------------- public (anonymous)

public_router = APIRouter(prefix="/public/stores/{slug}", tags=["public catalog"])
SlugPath = Annotated[str, Path(min_length=3, max_length=48, pattern=r"^[A-Za-z0-9-]+$")]
PUBLIC_RATE_LIMIT_PER_MINUTE = 300
JSON = "application/json"


async def _public_guard(request: Request) -> None:
    await enforce_rate_limit(
        f"public:{client_ip(request)}", limit=PUBLIC_RATE_LIMIT_PER_MINUTE, window_seconds=60
    )


def _public_response(body: str) -> Response:
    return Response(
        content=body,
        media_type=JSON,
        headers={
            # Short shared caching (Nginx/CDN); stock must stay close to live.
            "Cache-Control": "public, max-age=15",
            # The JSON API itself is never a search result; the HTML page decides indexing.
            "X-Robots-Tag": "noindex",
        },
    )


async def _serve(
    db: DbSession, slug: str, key: str, produce: Callable[[public.Store], Awaitable[str]]
) -> Response:
    # The store is resolved on every request (one indexed query) so disabling it is immediate;
    # the expensive part (the response) comes from the cache.
    store = await public.resolve_store(db, slug)
    body = await cache.cached_json(store.company.id, key, lambda: produce(store))
    return _public_response(body)


@public_router.get("", response_model=PublicStore, dependencies=[Depends(_public_guard)])
async def public_store(slug: SlugPath, db: DbSession) -> Response:
    async def produce(store: public.Store) -> str:
        return (await public.store_info(db, store)).model_dump_json()

    return await _serve(db, slug, "store", produce)


@public_router.get(
    "/products", response_model=PublicProductPage, dependencies=[Depends(_public_guard)]
)
async def public_products(
    slug: SlugPath,
    db: DbSession,
    q: Annotated[str | None, Query(max_length=60)] = None,
    category_id: uuid.UUID | None = None,
    branch_id: uuid.UUID | None = None,
    in_stock: bool = False,
    limit: Annotated[int, Query(ge=1, le=48)] = 24,
    offset: Annotated[int, Query(ge=0, le=10_000)] = 0,
) -> Response:
    async def produce(store: public.Store) -> str:
        page = await public.search_products(
            db,
            store,
            q=q,
            category_id=category_id,
            branch_id=branch_id,
            in_stock=in_stock,
            limit=limit,
            offset=offset,
        )
        return page.model_dump_json()

    search = (q or "").strip().lower()
    key = f"products|{search}|{category_id}|{branch_id}|{in_stock}|{limit}|{offset}"
    return await _serve(db, slug, key, produce)


@public_router.get(
    "/products/{product_id}",
    response_model=PublicProductDetail,
    dependencies=[Depends(_public_guard)],
)
async def public_product(
    slug: SlugPath, product_id: uuid.UUID, db: DbSession, branch_id: uuid.UUID | None = None
) -> Response:
    async def produce(store: public.Store) -> str:
        detail = await public.product_detail(db, store, product_id, branch_id)
        return detail.model_dump_json()

    return await _serve(db, slug, f"product|{product_id}|{branch_id}", produce)
