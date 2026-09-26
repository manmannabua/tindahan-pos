/**
 * Apply pulled rows (snake_case wire shapes) to the terminal database.
 *
 * - Upserts by id; inactive rows are kept (flagged) so history that references them still renders.
 * - Barcodes are unique by `code`: a code reassigned on the server arrives under the same row id,
 *   but if a *different* local row holds the code it is removed first.
 * - Variant `searchTokens` are rebuilt whenever a product or variant changes.
 * - Inventory balances update `serverQuantity`; `quantity` is recomputed by reconciliation.
 */
import type {
  LocalBarcode,
  LocalBranch,
  LocalCompany,
  LocalInventory,
  LocalStaff,
  LocalVariant,
  PosDatabase,
} from "@/lib/db/schema";
import type { PullResponse, PullTables, StaffSync } from "@/types/sync";

import { recomputeInventory } from "./reconcile";

export function searchTokens(...parts: (string | null | undefined)[]): string[] {
  const tokens = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    const lower = part.toLowerCase();
    tokens.add(lower.replace(/\s+/g, ""));
    for (const word of lower.split(/[^\p{L}\p{N}]+/u)) {
      if (word) tokens.add(word);
    }
  }
  return [...tokens];
}

const mapCompany = (r: PullTables["companies"]): LocalCompany => ({
  id: r.id,
  code: r.code,
  name: r.name,
  legalName: r.legal_name,
  tin: r.tin,
  currency: r.currency,
  timezone: r.timezone,
  pricesIncludeTax: r.prices_include_tax,
  vatRegistered: r.vat_registered ?? true,
  birAccreditationNo: r.bir_accreditation_no ?? null,
  settings: r.settings,
});

const mapBranch = (r: PullTables["branches"]): LocalBranch => ({
  id: r.id,
  code: r.code,
  name: r.name,
  address: r.address,
  phone: r.phone,
  tin: r.tin,
  receiptHeader: r.receipt_header,
  receiptFooter: r.receipt_footer,
  isActive: r.is_active,
});

export const mapStaff = (s: StaffSync): LocalStaff => ({
  id: s.id,
  username: s.username,
  fullName: s.full_name,
  isActive: s.is_active,
  canUsePos: s.can_use_pos,
  permissions: s.permissions,
  pinSalt: s.pin_offline_salt,
  pinVerifier: s.pin_offline_verifier,
  pinIterations: s.pin_offline_iterations,
  pinUpdatedAt: s.pin_updated_at,
});

export const DEXIE_TABLES = [
  "settings",
  "stockLocations",
  "categories",
  "brands",
  "units",
  "taxRates",
  "priceLevels",
  "paymentMethods",
  "products",
  "productUnits",
  "variants",
  "barcodes",
  "prices",
  "inventory",
  "inventoryMovements",
  "customers",
  "promotions",
] as const;

/** Apply one pull page in a single IndexedDB transaction. */
export async function applyPullPage(db: PosDatabase, page: PullResponse, now = new Date()): Promise<void> {
  const c = page.changes;
  await db.transaction("rw", [...DEXIE_TABLES.map((t) => db.table(t)), db.staff, db.meta], async () => {
    const company = c.companies?.at(-1);
    if (company) await db.settings.put({ key: "company", value: mapCompany(company) });
    const branch = c.branches?.at(-1);
    if (branch) await db.settings.put({ key: "branch", value: mapBranch(branch) });

    await db.stockLocations.bulkPut(
      (c.stock_locations ?? []).map((r) => ({
        id: r.id,
        branchId: r.branch_id,
        code: r.code,
        name: r.name,
        locationType: r.location_type,
        isDefault: r.is_default,
        isActive: r.is_active,
      })),
    );
    await db.categories.bulkPut(
      (c.categories ?? []).map((r) => ({
        id: r.id,
        parentId: r.parent_id,
        name: r.name,
        sortOrder: r.sort_order,
        isActive: r.is_active,
      })),
    );
    await db.brands.bulkPut((c.brands ?? []).map((r) => ({ id: r.id, name: r.name, isActive: r.is_active })));
    await db.units.bulkPut(
      (c.units ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        allowsDecimal: r.allows_decimal,
        isActive: r.is_active,
      })),
    );
    await db.taxRates.bulkPut(
      (c.tax_rates ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        rate: r.rate,
        kind: r.kind,
        isDefault: r.is_default,
        isActive: r.is_active,
      })),
    );
    await db.priceLevels.bulkPut(
      (c.price_levels ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        isDefault: r.is_default,
        sortOrder: r.sort_order,
        isActive: r.is_active,
      })),
    );
    await db.paymentMethods.bulkPut(
      (c.payment_methods ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        kind: r.kind,
        requiresReference: r.requires_reference,
        opensDrawer: r.opens_drawer,
        sortOrder: r.sort_order,
        isActive: r.is_active,
      })),
    );
    await db.products.bulkPut(
      (c.products ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        categoryId: r.category_id,
        brandId: r.brand_id,
        baseUnitId: r.base_unit_id,
        taxRateId: r.tax_rate_id,
        trackInventory: r.track_inventory,
        scPwdEligible: r.sc_pwd_eligible ?? false,
        imageUrl: r.image_url,
        isActive: r.is_active,
      })),
    );
    await db.productUnits.bulkPut(
      (c.product_units ?? []).map((r) => ({
        id: r.id,
        productId: r.product_id,
        unitId: r.unit_id,
        factor: r.factor,
        isBase: r.is_base,
        isActive: r.is_active,
      })),
    );

    // Variants: new/changed rows, plus existing variants of renamed products (search tokens).
    const variants: LocalVariant[] = (c.product_variants ?? []).map((r) => ({
      id: r.id,
      productId: r.product_id,
      sku: r.sku,
      name: r.name,
      attributes: r.attributes,
      reorderPoint: r.reorder_point,
      isDefault: r.is_default,
      isActive: r.is_active,
      searchTokens: [],
    }));
    const changedIds = new Set(variants.map((v) => v.id));
    for (const product of c.products ?? []) {
      const existing = await db.variants.where("productId").equals(product.id).toArray();
      variants.push(...existing.filter((v) => !changedIds.has(v.id)));
    }
    const productNames = new Map(
      (await db.products.bulkGet([...new Set(variants.map((v) => v.productId))])).flatMap((p) =>
        p ? [[p.id, p.name] as const] : [],
      ),
    );
    for (const v of variants) v.searchTokens = searchTokens(productNames.get(v.productId), v.name, v.sku);
    await db.variants.bulkPut(variants);

    for (const r of c.barcodes ?? []) {
      const holder = await db.barcodes.where("code").equals(r.code).first();
      if (holder && holder.id !== r.id) await db.barcodes.delete(holder.id);
      const row: LocalBarcode = {
        id: r.id,
        code: r.code,
        variantId: r.variant_id,
        productUnitId: r.product_unit_id,
        symbology: r.symbology,
        isPrimary: r.is_primary,
        isActive: r.is_active,
      };
      await db.barcodes.put(row);
    }

    await db.prices.bulkPut(
      (c.prices ?? []).map((r) => ({
        id: r.id,
        variantId: r.variant_id,
        productUnitId: r.product_unit_id,
        priceLevelId: r.price_level_id,
        branchId: r.branch_id,
        minQuantity: r.min_quantity,
        price: r.price,
        isActive: r.is_active,
      })),
    );

    const balances = c.inventory_balances ?? [];
    if (balances.length > 0) {
      const rows: LocalInventory[] = balances.map((r) => ({
        stockLocationId: r.stock_location_id,
        variantId: r.variant_id,
        serverQuantity: r.quantity,
        quantity: r.quantity,
        updatedAt: r.updated_at,
      }));
      await db.inventory.bulkPut(rows);
      await recomputeInventory(db, rows.map((r) => [r.stockLocationId, r.variantId]));
    }

    await db.customers.bulkPut(
      (c.customers ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        phone: r.phone,
        email: r.email,
        priceLevelId: r.price_level_id,
        isActive: r.is_active,
        searchTokens: searchTokens(r.name, r.code, r.phone),
      })),
    );
    await db.promotions.bulkPut((c.promotions ?? []).map((r) => ({ id: r.id, isActive: r.is_active, data: r })));

    if (page.staff) await replaceStaff(db, page.staff, now);
  });
}

export async function replaceStaff(db: PosDatabase, staff: StaffSync[], now = new Date()): Promise<void> {
  const rows = staff.map(mapStaff);
  const keep = new Set(rows.map((r) => r.id));
  const stale = (await db.staff.toCollection().primaryKeys()).filter((id) => !keep.has(id));
  await db.staff.bulkDelete(stale);
  await db.staff.bulkPut(rows);
  await db.meta.put({ key: "staffSyncedAt", value: now.toISOString() });
}

/** Local row counts per pulled table, for validating the initial download. */
export async function localCounts(db: PosDatabase): Promise<Partial<Record<keyof PullTables, number>>> {
  const settings = await db.settings.bulkGet(["company", "branch"]);
  return {
    companies: settings[0] ? 1 : 0,
    branches: settings[1] ? 1 : 0,
    stock_locations: await db.stockLocations.count(),
    categories: await db.categories.count(),
    brands: await db.brands.count(),
    units: await db.units.count(),
    tax_rates: await db.taxRates.count(),
    price_levels: await db.priceLevels.count(),
    payment_methods: await db.paymentMethods.count(),
    products: await db.products.count(),
    product_units: await db.productUnits.count(),
    product_variants: await db.variants.count(),
    barcodes: await db.barcodes.count(),
    prices: await db.prices.count(),
    inventory_balances: await db.inventory.count(),
    customers: await db.customers.count(),
    promotions: await db.promotions.count(),
  };
}
