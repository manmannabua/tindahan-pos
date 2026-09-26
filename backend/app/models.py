"""Import every model so SQLAlchemy's registry and Alembic autogenerate see all tables.

Add new modules' models here.
"""

from app.modules.audit.models import AuditLog
from app.modules.auth.models import RefreshToken
from app.modules.branches.models import Branch, StockLocation
from app.modules.brands.models import Brand
from app.modules.cash_management.models import CashMovement, CashSession
from app.modules.catalog_io.models import ImportJob
from app.modules.categories.models import Category
from app.modules.companies.models import Company
from app.modules.customers.models import Customer
from app.modules.devices.models import Device
from app.modules.expenses.models import Expense, ExpenseCategory
from app.modules.inventory.models import (
    InventoryBalance,
    InventoryMovement,
    StockAdjustment,
    StockAdjustmentLine,
    StockCount,
    StockCountLine,
    StockTransfer,
    StockTransferLine,
)
from app.modules.payments.models import Payment, PaymentMethod
from app.modules.pricing.models import Price, PriceLevel, TaxRate
from app.modules.products.models import Barcode, Product, ProductUnit, ProductVariant
from app.modules.promotions.models import Promotion
from app.modules.purchasing.models import (
    GoodsReceipt,
    GoodsReceiptLine,
    PurchaseOrder,
    PurchaseOrderLine,
)
from app.modules.reporting.models import ReportExport
from app.modules.returns.models import Refund, ReturnItem, SaleReturn
from app.modules.review_flags.models import ReviewFlag
from app.modules.sales.models import Sale, SaleItem
from app.modules.storefront.models import Storefront
from app.modules.suppliers.models import Supplier
from app.modules.sync.models import SyncOperation
from app.modules.units.models import Unit
from app.modules.users.models import Role, RolePermission, User, UserRole
from app.shared.models import Base
from app.shared.sequences import DocumentSequence

__all__ = [
    "AuditLog",
    "Barcode",
    "Base",
    "Branch",
    "Brand",
    "CashMovement",
    "CashSession",
    "Category",
    "Company",
    "Customer",
    "Device",
    "DocumentSequence",
    "Expense",
    "ExpenseCategory",
    "GoodsReceipt",
    "GoodsReceiptLine",
    "ImportJob",
    "InventoryBalance",
    "InventoryMovement",
    "Payment",
    "PaymentMethod",
    "Price",
    "PriceLevel",
    "Product",
    "ProductUnit",
    "ProductVariant",
    "Promotion",
    "PurchaseOrder",
    "PurchaseOrderLine",
    "RefreshToken",
    "Refund",
    "ReportExport",
    "ReturnItem",
    "ReviewFlag",
    "Role",
    "RolePermission",
    "Sale",
    "SaleItem",
    "SaleReturn",
    "StockAdjustment",
    "StockAdjustmentLine",
    "StockCount",
    "StockCountLine",
    "StockLocation",
    "StockTransfer",
    "StockTransferLine",
    "Storefront",
    "Supplier",
    "SyncOperation",
    "TaxRate",
    "Unit",
    "User",
    "UserRole",
]

# Tables whose rows POS terminals download; they get the sync_txid trigger.
# See docs/SYNC_PROTOCOL.md#pull.
SYNC_TRACKED_TABLES = [
    "companies",
    "branches",
    "stock_locations",
    "users",
    "roles",
    "devices",
    "categories",
    "brands",
    "units",
    "tax_rates",
    "price_levels",
    "products",
    "product_units",
    "product_variants",
    "barcodes",
    "prices",
    "inventory_balances",
    "payment_methods",
    "cash_sessions",
    "sales",
    "customers",
    "promotions",
]

# Append-only tables; UPDATE and DELETE are rejected by a trigger.
APPEND_ONLY_TABLES = ["audit_logs", "inventory_movements"]
