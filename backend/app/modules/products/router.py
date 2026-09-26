import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status

from app.modules.auth.dependencies import (
    CurrentPrincipal,
    DbSession,
    audit_actor,
    require_permission,
)
from app.modules.auth.principal import Principal
from app.modules.pricing import service as pricing
from app.modules.pricing.schemas import PriceRead, SetPricesRequest
from app.modules.products import service
from app.modules.products.models import Product, ProductVariant
from app.modules.products.schemas import (
    BarcodeIn,
    BarcodeLookup,
    BarcodeRead,
    BarcodeUpdate,
    GenerateBarcodeRequest,
    ProductCreate,
    ProductRead,
    ProductSummary,
    ProductUnitIn,
    ProductUnitRead,
    ProductUnitUpdate,
    ProductUpdate,
    VariantIn,
    VariantRead,
    VariantUpdate,
)
from app.modules.users.permissions import P
from app.shared import crud
from app.shared.schemas import Page

router = APIRouter(tags=["products"])
_read = [Depends(require_permission(P.PRODUCTS_READ))]


def _can_see_cost(principal: Principal) -> bool:
    return principal.has_in_any_scope(P.PRODUCTS_WRITE) or principal.has_in_any_scope(
        P.REPORTS_FINANCIAL
    )


def to_product_read(product: Product, principal: Principal) -> ProductRead:
    show_cost = _can_see_cost(principal)

    def variant(v: ProductVariant) -> VariantRead:
        return VariantRead(
            id=v.id,
            product_id=v.product_id,
            sku=v.sku,
            name=v.name,
            attributes=v.attributes,
            average_cost=v.average_cost if show_cost else None,
            last_cost=v.last_cost if show_cost else None,
            reorder_point=v.reorder_point,
            is_default=v.is_default,
            is_active=v.is_active,
            barcodes=[BarcodeRead.model_validate(b) for b in v.barcodes],
            prices=[PriceRead.model_validate(p) for p in v.prices],
        )

    return ProductRead(
        id=product.id,
        name=product.name,
        description=product.description,
        category_id=product.category_id,
        brand_id=product.brand_id,
        base_unit_id=product.base_unit_id,
        tax_rate_id=product.tax_rate_id,
        track_inventory=product.track_inventory,
        image_url=product.image_url,
        is_active=product.is_active,
        units=[
            ProductUnitRead(
                id=u.id,
                unit_id=u.unit_id,
                unit_code=u.unit.code,
                unit_name=u.unit.name,
                factor=u.factor,
                is_base=u.is_base,
                is_active=u.is_active,
            )
            for u in product.units
        ],
        variants=[variant(v) for v in product.variants],
    )


@router.get("/products", response_model=Page[ProductSummary], dependencies=_read)
async def list_products(
    principal: CurrentPrincipal,
    db: DbSession,
    q: Annotated[str | None, Query(max_length=100, description="Name, SKU or barcode")] = None,
    category_id: uuid.UUID | None = None,
    brand_id: uuid.UUID | None = None,
    include_inactive: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Page[ProductSummary]:
    rows, total = await service.list_products(
        db,
        principal.company_id,
        q=q,
        category_id=category_id,
        brand_id=brand_id,
        include_inactive=include_inactive,
        limit=limit,
        offset=offset,
    )
    items = [
        ProductSummary(
            id=p.id,
            name=p.name,
            category_id=p.category_id,
            brand_id=p.brand_id,
            track_inventory=p.track_inventory,
            is_active=p.is_active,
            variant_count=count,
            sku=sku,
            barcode=barcode,
            price=price,
        )
        for p, count, sku, barcode, price in rows
    ]
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.post("/products", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
async def create_product(
    data: ProductCreate, principal: CurrentPrincipal, request: Request, db: DbSession
) -> ProductRead:
    product = await service.create_product(db, principal, data, audit_actor(principal, request))
    return to_product_read(product, principal)


@router.get("/products/{product_id}", response_model=ProductRead, dependencies=_read)
async def get_product(
    product_id: uuid.UUID, principal: CurrentPrincipal, db: DbSession
) -> ProductRead:
    return to_product_read(
        await service.get_product(db, principal.company_id, product_id), principal
    )


@router.patch("/products/{product_id}", response_model=ProductRead)
async def update_product(
    product_id: uuid.UUID,
    data: ProductUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> ProductRead:
    product = await service.update_product(
        db, principal, product_id, data, audit_actor(principal, request)
    )
    return to_product_read(product, principal)


@router.post(
    "/products/{product_id}/units", response_model=ProductRead, status_code=status.HTTP_201_CREATED
)
async def add_product_unit(
    product_id: uuid.UUID,
    data: ProductUnitIn,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> ProductRead:
    product = await service.add_unit(
        db, principal, product_id, data, audit_actor(principal, request)
    )
    return to_product_read(product, principal)


@router.patch("/product-units/{product_unit_id}", response_model=ProductRead)
async def update_product_unit(
    product_unit_id: uuid.UUID,
    data: ProductUnitUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> ProductRead:
    product = await service.update_unit(
        db, principal, product_unit_id, data, audit_actor(principal, request)
    )
    return to_product_read(product, principal)


@router.post(
    "/products/{product_id}/variants",
    response_model=ProductRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_variant(
    product_id: uuid.UUID,
    data: VariantIn,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> ProductRead:
    product = await service.add_variant(
        db, principal, product_id, data, audit_actor(principal, request)
    )
    return to_product_read(product, principal)


@router.patch("/variants/{variant_id}", response_model=ProductRead)
async def update_variant(
    variant_id: uuid.UUID,
    data: VariantUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> ProductRead:
    product = await service.update_variant(
        db, principal, variant_id, data, audit_actor(principal, request)
    )
    return to_product_read(product, principal)


@router.put("/variants/{variant_id}/prices", response_model=list[PriceRead])
async def set_variant_prices(
    variant_id: uuid.UUID,
    data: SetPricesRequest,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> list[PriceRead]:
    """Replace the variant's price list (missing entries are deactivated)."""
    variant = await crud.get_scoped(db, ProductVariant, principal.company_id, variant_id, "variant")
    rows = await pricing.set_variant_prices(
        db, principal, variant, data.prices, audit_actor(principal, request)
    )
    return [PriceRead.model_validate(r) for r in rows]


@router.post(
    "/variants/{variant_id}/barcodes",
    response_model=BarcodeRead,
    status_code=status.HTTP_201_CREATED,
)
async def add_barcode(
    variant_id: uuid.UUID,
    data: BarcodeIn,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> BarcodeRead:
    barcode = await service.add_barcode(
        db, principal, variant_id, data, audit_actor(principal, request)
    )
    return BarcodeRead.model_validate(barcode)


@router.post(
    "/variants/{variant_id}/barcodes/generate",
    response_model=BarcodeRead,
    status_code=status.HTTP_201_CREATED,
)
async def generate_barcode(
    variant_id: uuid.UUID,
    data: GenerateBarcodeRequest,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> BarcodeRead:
    barcode = await service.generate_barcode(
        db, principal, variant_id, data.unit_id, audit_actor(principal, request)
    )
    return BarcodeRead.model_validate(barcode)


@router.patch("/barcodes/{barcode_id}", response_model=BarcodeRead)
async def update_barcode(
    barcode_id: uuid.UUID,
    data: BarcodeUpdate,
    principal: CurrentPrincipal,
    request: Request,
    db: DbSession,
) -> BarcodeRead:
    barcode = await service.update_barcode(
        db, principal, barcode_id, data, audit_actor(principal, request)
    )
    return BarcodeRead.model_validate(barcode)


@router.get("/barcodes/lookup", response_model=BarcodeLookup, dependencies=_read)
async def lookup_barcode(
    principal: CurrentPrincipal,
    db: DbSession,
    code: Annotated[str, Query(min_length=1, max_length=64)],
) -> BarcodeLookup:
    """Admin tool. The POS never uses this: scanning is resolved from IndexedDB."""
    barcode, product, variant = await service.lookup_barcode(db, principal.company_id, code)
    return BarcodeLookup(
        barcode=BarcodeRead.model_validate(barcode),
        product_id=product.id,
        product_name=product.name,
        variant_sku=variant.sku,
    )
