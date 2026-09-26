"""Permission catalogue and default role templates.

Permissions are code: the application decides *what can be checked*. Roles are data: each
company decides *who gets what*. Adding a permission here makes it available to every company;
the default templates are applied when a company is created.
"""

from enum import StrEnum


class P(StrEnum):
    # POS
    POS_ACCESS = "pos.access"
    SALES_VOID = "sales.void"
    SALES_DISCOUNT = "sales.discount"
    SALES_DISCOUNT_OVERRIDE = "sales.discount.override"
    SALES_PRICE_OVERRIDE = "sales.price.override"
    SALES_VIEW = "sales.view"
    RETURNS_CREATE = "returns.create"
    CASH_SESSION = "cash.session"
    CASH_MANAGE = "cash.manage"
    DRAWER_OPEN = "cash.drawer.open"
    RECEIPT_REPRINT = "sales.receipt.reprint"

    # Catalog
    PRODUCTS_READ = "products.read"
    PRODUCTS_WRITE = "products.write"
    PRICES_WRITE = "prices.write"

    # Inventory
    INVENTORY_READ = "inventory.read"
    INVENTORY_ADJUST = "inventory.adjust"
    INVENTORY_COUNT = "inventory.count"
    INVENTORY_TRANSFER = "inventory.transfer"

    # Purchasing
    SUPPLIERS_MANAGE = "suppliers.manage"
    PURCHASING_MANAGE = "purchasing.manage"
    PURCHASING_RECEIVE = "purchasing.receive"

    # Customers & promotions
    CUSTOMERS_READ = "customers.read"
    CUSTOMERS_WRITE = "customers.write"
    PROMOTIONS_MANAGE = "promotions.manage"

    # Management
    EXPENSES_MANAGE = "expenses.manage"
    REPORTS_VIEW = "reports.view"
    REPORTS_FINANCIAL = "reports.financial"
    REVIEW_FLAGS_MANAGE = "review_flags.manage"

    # Administration
    COMPANY_MANAGE = "company.manage"
    BRANCHES_MANAGE = "branches.manage"
    USERS_MANAGE = "users.manage"
    ROLES_MANAGE = "roles.manage"
    DEVICES_REGISTER = "devices.register"
    DEVICES_MANAGE = "devices.manage"
    SETTINGS_MANAGE = "settings.manage"
    AUDIT_VIEW = "audit.view"
    SYNC_MONITOR = "sync.monitor"


PERMISSION_DESCRIPTIONS: dict[P, str] = {
    P.POS_ACCESS: "Log in to POS terminals and sell",
    P.SALES_VOID: "Void completed sales",
    P.SALES_DISCOUNT: "Apply discounts within the cashier limit",
    P.SALES_DISCOUNT_OVERRIDE: "Apply discounts above the cashier limit",
    P.SALES_PRICE_OVERRIDE: "Change the selling price of an item",
    P.SALES_VIEW: "View sales history",
    P.RETURNS_CREATE: "Process returns and refunds",
    P.CASH_SESSION: "Open and close own cash sessions",
    P.CASH_MANAGE: "Cash in/out and manage all cash sessions",
    P.DRAWER_OPEN: "Open the cash drawer without a sale",
    P.RECEIPT_REPRINT: "Reprint receipts",
    P.PRODUCTS_READ: "View products",
    P.PRODUCTS_WRITE: "Create and edit products",
    P.PRICES_WRITE: "Change prices",
    P.INVENTORY_READ: "View inventory",
    P.INVENTORY_ADJUST: "Post stock adjustments",
    P.INVENTORY_COUNT: "Perform stock counts",
    P.INVENTORY_TRANSFER: "Transfer stock between locations",
    P.SUPPLIERS_MANAGE: "Manage suppliers",
    P.PURCHASING_MANAGE: "Create and approve purchase orders",
    P.PURCHASING_RECEIVE: "Receive goods",
    P.CUSTOMERS_READ: "View customers",
    P.CUSTOMERS_WRITE: "Create and edit customers",
    P.PROMOTIONS_MANAGE: "Manage promotions",
    P.EXPENSES_MANAGE: "Record expenses",
    P.REPORTS_VIEW: "View operational reports",
    P.REPORTS_FINANCIAL: "View cost, profit and margin reports",
    P.REVIEW_FLAGS_MANAGE: "Resolve review flags (negative stock, mismatches)",
    P.COMPANY_MANAGE: "Edit company settings",
    P.BRANCHES_MANAGE: "Manage branches and stock locations",
    P.USERS_MANAGE: "Manage users",
    P.ROLES_MANAGE: "Manage roles and permissions",
    P.DEVICES_REGISTER: "Register POS terminals",
    P.DEVICES_MANAGE: "Manage and revoke POS terminals",
    P.SETTINGS_MANAGE: "Manage POS settings",
    P.AUDIT_VIEW: "View the audit log",
    P.SYNC_MONITOR: "View sync status and resolve sync issues",
}

ALL_PERMISSIONS: frozenset[P] = frozenset(P)

_CASHIER = {
    P.POS_ACCESS,
    P.SALES_DISCOUNT,
    P.CASH_SESSION,
    P.PRODUCTS_READ,
    P.INVENTORY_READ,
    P.CUSTOMERS_READ,
    P.CUSTOMERS_WRITE,
    P.RECEIPT_REPRINT,
}

_MANAGER = _CASHIER | {
    P.SALES_VOID,
    P.SALES_DISCOUNT_OVERRIDE,
    P.SALES_PRICE_OVERRIDE,
    P.SALES_VIEW,
    P.RETURNS_CREATE,
    P.CASH_MANAGE,
    P.DRAWER_OPEN,
    P.INVENTORY_ADJUST,
    P.INVENTORY_COUNT,
    P.INVENTORY_TRANSFER,
    P.PURCHASING_RECEIVE,
    P.EXPENSES_MANAGE,
    P.REPORTS_VIEW,
    P.REVIEW_FLAGS_MANAGE,
    P.DEVICES_REGISTER,
    P.SYNC_MONITOR,
}

# code -> (name, description, permissions)
DEFAULT_ROLES: dict[str, tuple[str, str, frozenset[P]]] = {
    "OWNER": ("Owner", "Full access to everything", ALL_PERMISSIONS),
    "ADMIN": (
        "Administrator",
        "Full access except ownership-level settings",
        ALL_PERMISSIONS - {P.COMPANY_MANAGE},
    ),
    "MANAGER": ("Store Manager", "Runs a branch: approvals, stock, reports", frozenset(_MANAGER)),
    "CASHIER": ("Cashier", "Sells at the POS", frozenset(_CASHIER)),
    "INVENTORY_CLERK": (
        "Inventory Clerk",
        "Counts, adjusts, transfers and receives stock",
        frozenset(
            {
                P.PRODUCTS_READ,
                P.INVENTORY_READ,
                P.INVENTORY_ADJUST,
                P.INVENTORY_COUNT,
                P.INVENTORY_TRANSFER,
                P.PURCHASING_RECEIVE,
                P.SUPPLIERS_MANAGE,
            }
        ),
    ),
    "ACCOUNTANT": (
        "Accountant",
        "Reports, expenses and purchasing",
        frozenset(
            {
                P.SALES_VIEW,
                P.PRODUCTS_READ,
                P.INVENTORY_READ,
                P.REPORTS_VIEW,
                P.REPORTS_FINANCIAL,
                P.EXPENSES_MANAGE,
                P.PURCHASING_MANAGE,
                P.SUPPLIERS_MANAGE,
                P.CUSTOMERS_READ,
                P.AUDIT_VIEW,
            }
        ),
    ),
}
