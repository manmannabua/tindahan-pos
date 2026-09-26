/**
 * Price resolution — mirrors backend/app/modules/pricing/resolver.py.
 *
 * 1. Requested price level first, then the company's default level.
 * 2. Within a level, a branch-specific price beats a company-wide one.
 * 3. The highest `minQuantity` <= quantity wins (quantity breaks).
 * No price for the unit → null (never derived from another unit).
 */
import { compare, type DecimalInput } from "@/lib/money";

export interface PriceCandidate {
  productUnitId: string;
  priceLevelId: string;
  branchId: string | null;
  minQuantity: string;
  price: string;
}

export interface ResolvePriceArgs {
  productUnitId: string;
  priceLevelId: string;
  defaultPriceLevelId: string;
  branchId: string | null;
  quantity: DecimalInput;
}

export function resolvePrice<T extends PriceCandidate>(candidates: readonly T[], args: ResolvePriceArgs): T | null {
  const pool = candidates.filter((c) => c.productUnitId === args.productUnitId);
  const levels = [args.priceLevelId];
  if (args.defaultPriceLevelId !== args.priceLevelId) levels.push(args.defaultPriceLevelId);

  for (const level of levels) {
    const inLevel = pool.filter(
      (c) =>
        c.priceLevelId === level &&
        compare(c.minQuantity, args.quantity) <= 0 &&
        (c.branchId === null || c.branchId === args.branchId),
    );
    if (inLevel.length === 0) continue;
    const branchSpecific = inLevel.filter((c) => c.branchId !== null);
    const chosenFrom = branchSpecific.length > 0 ? branchSpecific : inLevel;
    return chosenFrom.reduce((best, c) => (compare(c.minQuantity, best.minQuantity) > 0 ? c : best));
  }
  return null;
}
