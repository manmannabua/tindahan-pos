/**
 * Catalog lookups for the checkout path. Pure IndexedDB — never the network.
 * See docs/BARCODE_SCANNER.md §5.
 */
import { barcodeCandidates } from "@/lib/barcode/normalize";

import type { LocalPrice, PosDatabase, TaxKind } from "./schema";

/** Everything the cart needs to sell one variant in one unit. */
export interface SellableItem {
  variantId: string;
  productId: string;
  productName: string;
  variantName: string | null;
  sku: string;
  /** For promotion targeting. Optional: carts checkpointed by older versions lack them. */
  categoryId?: string | null;
  brandId?: string | null;
  productUnitId: string;
  unitId: string;
  unitCode: string;
  unitFactor: string;
  allowsDecimal: boolean;
  barcode: string | null;
  taxRateId: string | null;
  taxRate: string;
  taxKind: TaxKind;
  trackInventory: boolean;
  /** Active prices of the variant (all units/levels/branches); the cart resolves one. */
  prices: LocalPrice[];
}

export type ScanLookup =
  | { status: "found"; item: SellableItem }
  | { status: "not_found"; code: string }
  | { status: "inactive"; code: string; name: string };

export async function lookupBarcode(db: PosDatabase, raw: string): Promise<ScanLookup> {
  const candidates = barcodeCandidates(raw);
  for (const code of candidates) {
    const barcode = await db.barcodes.where("code").equals(code).first();
    if (!barcode) continue;
    const item = await loadSellable(db, barcode.variantId, barcode.productUnitId, barcode.code);
    if (!item) return { status: "not_found", code };
    if (!barcode.isActive) return { status: "inactive", code, name: item.productName };
    const variant = await db.variants.get(barcode.variantId);
    const product = await db.products.get(item.productId);
    if (!variant?.isActive || !product?.isActive) return { status: "inactive", code, name: item.productName };
    return { status: "found", item };
  }
  return { status: "not_found", code: candidates[0] ?? raw };
}

/** Load a variant for sale in `productUnitId` (default: the product's base unit). */
export async function loadSellable(
  db: PosDatabase,
  variantId: string,
  productUnitId?: string,
  barcode: string | null = null,
): Promise<SellableItem | null> {
  const variant = await db.variants.get(variantId);
  if (!variant) return null;
  const product = await db.products.get(variant.productId);
  if (!product) return null;
  const productUnit = productUnitId
    ? await db.productUnits.get(productUnitId)
    : (await db.productUnits.where("productId").equals(product.id).toArray()).find((u) => u.isBase);
  if (!productUnit) return null;
  const [unit, taxRate, prices] = await Promise.all([
    db.units.get(productUnit.unitId),
    db.taxRates.get(product.taxRateId),
    db.prices.where("variantId").equals(variant.id).toArray(),
  ]);
  return {
    variantId: variant.id,
    productId: product.id,
    productName: product.name,
    variantName: variant.name,
    sku: variant.sku,
    categoryId: product.categoryId,
    brandId: product.brandId,
    productUnitId: productUnit.id,
    unitId: productUnit.unitId,
    unitCode: unit?.code ?? "",
    unitFactor: productUnit.factor,
    allowsDecimal: unit?.allowsDecimal ?? false,
    barcode,
    taxRateId: taxRate?.id ?? null,
    taxRate: taxRate?.rate ?? "0",
    taxKind: taxRate?.kind ?? "VATABLE",
    trackInventory: product.trackInventory,
    prices: prices.filter((p) => p.isActive),
  };
}

export interface SearchResult {
  variantId: string;
  productName: string;
  variantName: string | null;
  sku: string;
}

/** Prefix search over name words and SKU. Every query word must prefix-match some token. */
export async function searchCatalog(db: PosDatabase, query: string, limit = 20): Promise<SearchResult[]> {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (words.length === 0) return [];
  const [first, ...rest] = words.sort((a, b) => b.length - a.length);
  const matches = await db.variants
    .where("searchTokens")
    .startsWith(first)
    .distinct()
    .filter((v) => v.isActive && rest.every((w) => v.searchTokens.some((t) => t.startsWith(w))))
    .limit(limit * 2)
    .toArray();
  const products = await db.products.bulkGet(matches.map((v) => v.productId));
  return matches
    .flatMap((v, i) => {
      const product = products[i];
      return product?.isActive ? [{ variantId: v.id, productName: product.name, variantName: v.name, sku: v.sku }] : [];
    })
    .sort((a, b) => a.productName.localeCompare(b.productName))
    .slice(0, limit);
}
