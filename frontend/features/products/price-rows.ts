/**
 * Price list editing model. The editor works with flat rows; the API takes `PriceIn[]`
 * (unit by `units.id`, null = base unit; level null = default level; branch null = all).
 * PUT /variants/{id}/prices replaces the whole list, so rows are always sent complete.
 */
import { isValidDecimal, toBig } from "@/lib/money";
import type { Price, PriceIn, ProductUnit } from "@/types/api-admin";

export interface PriceRow {
  key: string;
  /** units.id, or "" for the base unit. */
  unitId: string;
  /** price_levels.id, or "" for the default level. */
  levelId: string;
  /** branches.id, or "" for all branches. */
  branchId: string;
  minQuantity: string;
  price: string;
}

let counter = 0;
export function newRowKey(): string {
  counter += 1;
  return `row-${counter}`;
}

export function emptyPriceRow(): PriceRow {
  return { key: newRowKey(), unitId: "", levelId: "", branchId: "", minQuantity: "1", price: "" };
}

const MONEY = /^\d+(\.\d{1,2})?$/;
const QTY = /^\d+(\.\d{1,3})?$/;

export interface PriceRowsResult {
  prices: PriceIn[];
  /** Row key → message. */
  errors: Record<string, string>;
}

export function toPriceIn(rows: PriceRow[]): PriceRowsResult {
  const errors: Record<string, string> = {};
  const seen = new Set<string>();
  const prices: PriceIn[] = [];
  for (const row of rows) {
    const price = row.price.trim();
    const minQuantity = row.minQuantity.trim() || "1";
    if (!MONEY.test(price)) {
      errors[row.key] = "Price must be an amount like 25 or 25.50";
      continue;
    }
    if (!QTY.test(minQuantity) || toBig(minQuantity).lte("0")) {
      errors[row.key] = "Minimum quantity must be greater than 0";
      continue;
    }
    const identity = [row.unitId, row.levelId, row.branchId, toBig(minQuantity).toString()].join("|");
    if (seen.has(identity)) {
      errors[row.key] = "Duplicate: same unit, level, branch and minimum quantity";
      continue;
    }
    seen.add(identity);
    prices.push({
      price,
      min_quantity: minQuantity,
      unit_id: row.unitId || null,
      price_level_id: row.levelId || null,
      branch_id: row.branchId || null,
    });
  }
  return { prices, errors };
}

/** Active server prices → editor rows. Base-unit rows get unitId "" so they stay "base". */
export function fromPrices(prices: Price[], units: ProductUnit[], defaultLevelId?: string): PriceRow[] {
  const unitOf = new Map(units.map((u) => [u.id, u]));
  return prices
    .filter((p) => p.is_active)
    .map((p) => {
      const unit = unitOf.get(p.product_unit_id);
      return {
        key: newRowKey(),
        unitId: !unit || unit.is_base ? "" : unit.unit_id,
        levelId: p.price_level_id === defaultLevelId ? "" : p.price_level_id,
        branchId: p.branch_id ?? "",
        minQuantity: toBig(p.min_quantity).toString(),
        price: toBig(p.price).toFixed(2),
      };
    })
    .sort((a, b) => a.unitId.localeCompare(b.unitId) || a.levelId.localeCompare(b.levelId) || toBig(a.minQuantity).cmp(toBig(b.minQuantity)));
}

/** A cost in 4 decimals, or null when blank. Throws nothing: invalid → undefined. */
export function parseCost(value: string): string | null | undefined {
  const v = value.trim();
  if (v === "") return null;
  return /^\d+(\.\d{1,4})?$/.test(v) && isValidDecimal(v) ? v : undefined;
}
