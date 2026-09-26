"""Versioned API router: every module router is mounted under /api/v1."""

from fastapi import APIRouter

from app.modules.audit.router import router as audit_router
from app.modules.auth.router import router as auth_router
from app.modules.branches.router import locations_router
from app.modules.branches.router import router as branches_router
from app.modules.brands.router import router as brands_router
from app.modules.catalog_io.router import router as catalog_io_router
from app.modules.categories.router import router as categories_router
from app.modules.companies.router import router as companies_router
from app.modules.customers.router import router as customers_router
from app.modules.dashboard.router import router as dashboard_router
from app.modules.devices.router import router as devices_router
from app.modules.expenses.router import router as expenses_router
from app.modules.health.router import router as health_router
from app.modules.inventory.operations_router import router as inventory_ops_router
from app.modules.inventory.router import router as inventory_router
from app.modules.payments.router import router as payments_router
from app.modules.pricing.router import router as pricing_router
from app.modules.products.router import router as products_router
from app.modules.promotions.router import router as promotions_router
from app.modules.purchasing.router import router as purchasing_router
from app.modules.realtime.router import router as realtime_router
from app.modules.reporting.router import router as reporting_router
from app.modules.returns.router import router as returns_router
from app.modules.review_flags.router import router as review_flags_router
from app.modules.sales.router import router as sales_router
from app.modules.suppliers.router import router as suppliers_router
from app.modules.sync.router import router as sync_router
from app.modules.units.router import router as units_router
from app.modules.users.router import router as users_router

api_router = APIRouter()
for r in (
    health_router,
    auth_router,
    companies_router,
    branches_router,
    locations_router,
    users_router,
    devices_router,
    audit_router,
    categories_router,
    brands_router,
    units_router,
    pricing_router,
    products_router,
    inventory_router,
    inventory_ops_router,
    review_flags_router,
    payments_router,
    sync_router,
    sales_router,
    suppliers_router,
    purchasing_router,
    customers_router,
    returns_router,
    promotions_router,
    expenses_router,
    reporting_router,
    dashboard_router,
    realtime_router,
    catalog_io_router,
):
    api_router.include_router(r)
