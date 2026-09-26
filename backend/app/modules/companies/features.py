"""Optional features ("modules") an owner can switch on or off per company.

Core selling — products, the POS checkout, sales history, reports, staff, terminals — is always
on. Everything below is optional. A disabled feature is hidden in the admin portal and on the
terminals and its admin endpoints answer `403 feature.disabled`.

Sync is deliberately NOT gated: a terminal may have sold with a feature on (e.g. a promotion or
a customer) while offline before the owner turned it off. Those facts are still accepted — the
system never loses a sale because of a settings change.

Storage: `companies.features` holds explicit choices only. A missing key means "on", so every
feature added later is on for existing companies until the owner decides otherwise.
"""

from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class Feature(StrEnum):
    INVENTORY = "inventory"
    PURCHASING = "purchasing"
    CUSTOMERS = "customers"
    PROMOTIONS = "promotions"
    DISCOUNTS = "discounts"
    RETURNS = "returns"
    CASH_MANAGEMENT = "cash_management"
    EXPENSES = "expenses"
    SC_PWD = "sc_pwd"
    BIR = "bir"
    ONLINE_CATALOG = "online_catalog"
    RECEIPT_JOURNAL = "receipt_journal"


@dataclass(frozen=True, slots=True)
class FeatureInfo:
    label: str
    description: str
    group: str
    requires: tuple[Feature, ...] = ()


FEATURES: dict[Feature, FeatureInfo] = {
    Feature.INVENTORY: FeatureInfo(
        "Stock tracking",
        "Stock levels per branch, stock counts, transfers and low-stock alerts.",
        "Inventory",
    ),
    Feature.PURCHASING: FeatureInfo(
        "Purchasing & suppliers",
        "Suppliers, purchase orders and receiving deliveries into stock.",
        "Inventory",
        requires=(Feature.INVENTORY,),
    ),
    Feature.CUSTOMERS: FeatureInfo(
        "Customers",
        "Customer list, customer on sales and customer price levels.",
        "Selling",
    ),
    Feature.PROMOTIONS: FeatureInfo(
        "Promotions",
        "Automatic promos at the counter (percent off, buy X get Y, fixed prices).",
        "Selling",
    ),
    Feature.DISCOUNTS: FeatureInfo(
        "Manual discounts",
        "Cashiers can give line or whole-sale discounts (with limits and approvals).",
        "Selling",
    ),
    Feature.RETURNS: FeatureInfo(
        "Returns & refunds",
        "Take back items and refund them, at the counter or from the back office.",
        "Selling",
    ),
    Feature.CASH_MANAGEMENT: FeatureInfo(
        "Cash drawer sessions",
        "Opening float, cash in/out, end-of-shift count with over/short.",
        "Money",
    ),
    Feature.EXPENSES: FeatureInfo(
        "Expenses", "Record store expenses (paid from the drawer or elsewhere).", "Money"
    ),
    Feature.SC_PWD: FeatureInfo(
        "Senior citizen / PWD discounts",
        "The 20% statutory discount with VAT exemption, and the SC/PWD sales book.",
        "Philippines",
    ),
    Feature.BIR: FeatureInfo(
        "BIR compliance",
        "BIR registration fields (MIN, PTU, accreditation) and X/Z readings.",
        "Philippines",
    ),
    Feature.ONLINE_CATALOG: FeatureInfo(
        "Online catalog",
        "A public page where customers browse your products, prices and stock.",
        "Online",
    ),
    Feature.RECEIPT_JOURNAL: FeatureInfo(
        "Receipt journal screens",
        "Browse every issued receipt, printed or not. (Receipts are always kept.)",
        "Selling",
    ),
}

# Starting points offered during onboarding; the owner fine-tunes afterwards.
PRESETS: dict[str, tuple[str, str, frozenset[Feature]]] = {
    "basic": (
        "Basic",
        "Just selling: stock, cash drawer, discounts and returns.",
        frozenset({Feature.INVENTORY, Feature.CASH_MANAGEMENT, Feature.DISCOUNTS, Feature.RETURNS}),
    ),
    "standard": (
        "Standard",
        "A mini-mart or grocery: adds purchasing, customers, promos, expenses and PH rules.",
        frozenset(set(Feature) - {Feature.ONLINE_CATALOG}),
    ),
    "everything": ("Everything", "All features, including the online catalog.", frozenset(Feature)),
}


def effective(stored: dict[str, Any] | None) -> dict[Feature, bool]:
    """All features with their on/off state (missing = on; dependencies enforced)."""
    raw = stored or {}
    state = {f: bool(raw.get(f.value, True)) for f in Feature}
    for feature, info in FEATURES.items():
        if state[feature] and not all(state[r] for r in info.requires):
            state[feature] = False
    return state


def missing_requirements(state: dict[Feature, bool]) -> list[tuple[Feature, Feature]]:
    """(feature, requirement) pairs where a feature is on but something it needs is off."""
    return [
        (feature, required)
        for feature, info in FEATURES.items()
        if state.get(feature, True)
        for required in info.requires
        if not state.get(required, True)
    ]
