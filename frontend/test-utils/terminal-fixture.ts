/**
 * Test fixture: a terminal database seeded through the real pull applier (so tests exercise the
 * same code path as a device download).
 */
import { setMeta } from "@/lib/db/meta";
import { PosDatabase, setDbForTests } from "@/lib/db/schema";
import { loadSellable, type SellableItem } from "@/lib/db/catalog";
import { applyPullPage } from "@/lib/sync/pull-applier";
import type { PullResponse, StaffSync } from "@/types/sync";

export const IDS = {
  company: "c0000000-0000-7000-8000-000000000001",
  branch: "b0000000-0000-7000-8000-000000000001",
  location: "10000000-0000-7000-8000-000000000001",
  device: "d0000000-0000-7000-8000-000000000001",
  unitPc: "u0000000-0000-7000-8000-000000000001",
  unitBox: "u0000000-0000-7000-8000-000000000002",
  vat: "t0000000-0000-7000-8000-000000000001",
  retail: "l0000000-0000-7000-8000-000000000001",
  wholesale: "l0000000-0000-7000-8000-000000000002",
  cash: "m0000000-0000-7000-8000-000000000001",
  gcash: "m0000000-0000-7000-8000-000000000002",
  coke: "p0000000-0000-7000-8000-000000000001",
  cokeVariant: "v0000000-0000-7000-8000-000000000001",
  cokePc: "pu000000-0000-7000-8000-000000000001",
  cokeBox: "pu000000-0000-7000-8000-000000000002",
  cashier: "s0000000-0000-7000-8000-000000000001",
  manager: "s0000000-0000-7000-8000-000000000002",
} as const;

export function staffRow(overrides: Partial<StaffSync> & Pick<StaffSync, "id" | "username">): StaffSync {
  return {
    full_name: overrides.username,
    is_active: true,
    can_use_pos: true,
    permissions: ["pos.access", "sales.discount", "cash.session"],
    pin_offline_salt: null,
    pin_offline_verifier: null,
    pin_offline_iterations: null,
    pin_updated_at: null,
    ...overrides,
  };
}

export function catalogPage(overrides: Partial<PullResponse> = {}): PullResponse {
  return {
    changes: {
      companies: [
        { id: IDS.company, code: "ACME", name: "Acme Mart", legal_name: null, tin: "123-456", currency: "PHP", timezone: "Asia/Manila", prices_include_tax: true, settings: {} },
      ],
      branches: [
        { id: IDS.branch, code: "MAIN", name: "Main", address: "1 Rizal St", phone: null, tin: null, receipt_header: null, receipt_footer: "Salamat!", is_active: true },
      ],
      stock_locations: [
        { id: IDS.location, branch_id: IDS.branch, code: "STORE", name: "Store", location_type: "STORE", is_default: true, is_active: true },
      ],
      units: [
        { id: IDS.unitPc, code: "PC", name: "Piece", allows_decimal: false, is_active: true },
        { id: IDS.unitBox, code: "BOX", name: "Box", allows_decimal: false, is_active: true },
      ],
      tax_rates: [{ id: IDS.vat, code: "VAT12", name: "VAT 12%", rate: "12.000", kind: "VATABLE", is_default: true, is_active: true }],
      price_levels: [
        { id: IDS.retail, code: "RETAIL", name: "Retail", is_default: true, sort_order: 0, is_active: true },
        { id: IDS.wholesale, code: "WHOLESALE", name: "Wholesale", is_default: false, sort_order: 1, is_active: true },
      ],
      payment_methods: [
        { id: IDS.cash, code: "CASH", name: "Cash", kind: "CASH", requires_reference: false, opens_drawer: true, sort_order: 0, is_active: true },
        { id: IDS.gcash, code: "GCASH", name: "GCash", kind: "EWALLET", requires_reference: true, opens_drawer: false, sort_order: 1, is_active: true },
      ],
      products: [
        { id: IDS.coke, name: "Coke 1.5L", category_id: null, brand_id: null, base_unit_id: IDS.unitPc, tax_rate_id: IDS.vat, track_inventory: true, image_url: null, is_active: true },
      ],
      product_units: [
        { id: IDS.cokePc, product_id: IDS.coke, unit_id: IDS.unitPc, factor: "1.000000", is_base: true, is_active: true },
        { id: IDS.cokeBox, product_id: IDS.coke, unit_id: IDS.unitBox, factor: "12.000000", is_base: false, is_active: true },
      ],
      product_variants: [
        { id: IDS.cokeVariant, product_id: IDS.coke, sku: "COKE15", name: null, attributes: {}, reorder_point: null, is_default: true, is_active: true },
      ],
      barcodes: [
        { id: "bc000000-0000-7000-8000-000000000001", variant_id: IDS.cokeVariant, product_unit_id: IDS.cokePc, code: "4800361419116", symbology: "EAN13", is_primary: true, is_active: true },
        { id: "bc000000-0000-7000-8000-000000000002", variant_id: IDS.cokeVariant, product_unit_id: IDS.cokeBox, code: "CASE-COKE", symbology: "CODE128_OR_OTHER", is_primary: false, is_active: true },
      ],
      prices: [
        { id: "pr000000-0000-7000-8000-000000000001", variant_id: IDS.cokeVariant, product_unit_id: IDS.cokePc, price_level_id: IDS.retail, branch_id: null, min_quantity: "1.000", price: "75.00", is_active: true },
        { id: "pr000000-0000-7000-8000-000000000002", variant_id: IDS.cokeVariant, product_unit_id: IDS.cokeBox, price_level_id: IDS.retail, branch_id: null, min_quantity: "1.000", price: "850.00", is_active: true },
      ],
      inventory_balances: [{ stock_location_id: IDS.location, variant_id: IDS.cokeVariant, quantity: "10.000", updated_at: "2026-09-26T00:00:00Z" }],
    },
    staff: [
      staffRow({ id: IDS.cashier, username: "cathy", full_name: "Cathy Cashier" }),
      staffRow({ id: IDS.manager, username: "mara", full_name: "Mara Manager", permissions: ["pos.access", "sales.discount", "sales.discount.override", "sales.price.override", "cash.manage", "cash.session"] }),
    ],
    counts: null,
    next_cursor: "cursor-1",
    has_more: false,
    server_time: "2026-09-26T00:00:00Z",
    ...overrides,
  };
}

/** A fresh READY terminal database registered as the fixture device (also installed as getDb()). */
export async function createTerminalDb(): Promise<PosDatabase> {
  const db = new PosDatabase(`test-${crypto.randomUUID()}`);
  await db.open();
  await applyPullPage(db, catalogPage());
  await setMeta(db, "device", {
    deviceId: IDS.device,
    terminalCode: "T01",
    companyId: IDS.company,
    branchId: IDS.branch,
    receiptPrefix: "MAIN-T01-",
    defaultStockLocationId: IDS.location,
    registeredAt: "2026-09-26T00:00:00Z",
  });
  await setMeta(db, "initStatus", "READY");
  await setMeta(db, "receiptSeq", 0);
  setDbForTests(db);
  return db;
}

export async function destroyDb(db: PosDatabase): Promise<void> {
  setDbForTests(null);
  db.close();
  await db.delete();
}

export async function coke(db: PosDatabase, unit: "pc" | "box" = "pc"): Promise<SellableItem> {
  const item = await loadSellable(db, IDS.cokeVariant, unit === "pc" ? IDS.cokePc : IDS.cokeBox);
  if (!item) throw new Error("fixture item missing");
  return item;
}

export const PRICE_CONTEXT = {
  priceLevelId: IDS.retail,
  defaultPriceLevelId: IDS.retail,
  branchId: IDS.branch,
  pricesIncludeTax: true,
};
