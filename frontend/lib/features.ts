/**
 * Optional features the owner switches on/off per business (backend companies/features.py).
 * Missing keys count as ON, matching the server, so a newer server feature never hides UI.
 */
export const FEATURE_KEYS = [
  "inventory",
  "purchasing",
  "customers",
  "promotions",
  "discounts",
  "returns",
  "cash_management",
  "expenses",
  "sc_pwd",
  "bir",
  "online_catalog",
  "receipt_journal",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export type FeatureState = Partial<Record<string, boolean>>;

export function isFeatureOn(features: FeatureState | null | undefined, key: FeatureKey): boolean {
  return features?.[key] ?? true;
}

/** Admin routes that belong to an optional feature (longest prefix wins). */
const ROUTE_FEATURES: [prefix: string, feature: FeatureKey][] = [
  ["/inventory", "inventory"],
  ["/purchase-orders", "purchasing"],
  ["/suppliers", "purchasing"],
  ["/customers", "customers"],
  ["/promotions", "promotions"],
  ["/expenses", "expenses"],
  ["/sales/returns", "returns"],
  ["/online-catalog", "online_catalog"],
  ["/receipts", "receipt_journal"],
];

export function featureForRoute(pathname: string): FeatureKey | null {
  const match = ROUTE_FEATURES.filter(([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`)).sort(
    (a, b) => b[0].length - a[0].length,
  )[0];
  return match ? match[1] : null;
}

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  inventory: "Stock tracking",
  purchasing: "Purchasing & suppliers",
  customers: "Customers",
  promotions: "Promotions",
  discounts: "Manual discounts",
  returns: "Returns & refunds",
  cash_management: "Cash drawer sessions",
  expenses: "Expenses",
  sc_pwd: "Senior citizen / PWD discounts",
  bir: "BIR compliance",
  online_catalog: "Online catalog",
  receipt_journal: "Receipt journal screens",
};
