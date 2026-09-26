/**
 * Cart model — pure functions (the Zustand store in stores/cart-store.ts wraps them).
 *
 * Prices are resolved from the local price list whenever quantity changes (quantity breaks),
 * unless a manager overrode the price. Promotions are re-evaluated after every change and become
 * ordinary AMOUNT line discounts (docs: backend promotions/evaluator.py). Totals always come
 * from lib/money/sale-calculation, the same algorithm the server uses to verify the sale.
 */
import { v7 as uuidv7 } from "uuid";

import type { SellableItem } from "@/lib/db/catalog";
import type { LocalDiscount } from "@/lib/db/schema";
import { add, compare, toQuantityString } from "@/lib/money";
import {
  CalculationError,
  calculateSale,
  type SaleCalculation,
} from "@/lib/money/sale-calculation";
import { resolvePrice } from "@/lib/pricing/resolve-price";
import { evaluatePromotions, type PromoDef } from "@/lib/promotions/evaluate";

export interface PriceContext {
  priceLevelId: string;
  defaultPriceLevelId: string;
  branchId: string;
  pricesIncludeTax: boolean;
}

/** What promotions are evaluated against (loaded from IndexedDB at start-up). */
export interface PromoContext {
  promotions: PromoDef[];
  timeZone: string;
  branchId: string;
}

export interface PriceOverride {
  price: string;
  authorizedById: string | null;
}

export interface AppliedLinePromotion {
  id: string;
  name: string;
  /** Discount amount for the whole line (2-decimal string). */
  discount: string;
}

export interface CartLine {
  /** Becomes the sale item id (client-generated UUIDv7). */
  id: string;
  item: SellableItem;
  quantity: string;
  /** Resolved list price; null if the product has no price for this unit/level. */
  listPrice: string | null;
  override: PriceOverride | null;
  /** Manual discount (cashier/manager). Wins over promotions. */
  discount: LocalDiscount | null;
  /** Promotion currently applied (derived; recomputed on every change). */
  promotion?: AppliedLinePromotion | null;
  /** The cashier removed promotions from this line. */
  promotionsDisabled?: boolean;
}

export interface CartCustomer {
  id: string;
  name: string;
  priceLevelId: string | null;
}

export interface Cart {
  lines: CartLine[];
  orderDiscount: LocalDiscount | null;
  customerId: string | null;
  /** Display data for the selected customer (optional in older checkpoints). */
  customer?: CartCustomer | null;
}

export const EMPTY_CART: Cart = { lines: [], orderDiscount: null, customerId: null, customer: null };

export function unitPrice(line: CartLine): string | null {
  return line.override?.price ?? line.listPrice;
}

/** The discount that actually applies to a line: manual first, then the promotion. */
export function effectiveDiscount(line: CartLine): LocalDiscount | null {
  if (line.discount) return line.discount;
  if (line.promotion) {
    return { kind: "AMOUNT", value: line.promotion.discount, reason: line.promotion.name, authorizedById: null };
  }
  return null;
}

function listPriceFor(item: SellableItem, quantity: string, ctx: PriceContext): string | null {
  return (
    resolvePrice(item.prices, {
      productUnitId: item.productUnitId,
      priceLevelId: ctx.priceLevelId,
      defaultPriceLevelId: ctx.defaultPriceLevelId,
      branchId: ctx.branchId,
      quantity,
    })?.price ?? null
  );
}

/** Add one unit (scan). Increments an identical plain line instead of adding a new one. */
export function addItem(cart: Cart, item: SellableItem, ctx: PriceContext, quantity = "1"): Cart {
  const existing = cart.lines.find(
    (l) => l.item.variantId === item.variantId && l.item.productUnitId === item.productUnitId && !l.override && !l.discount,
  );
  if (existing) return setQuantity(cart, existing.id, toQuantityString(add(existing.quantity, quantity)), ctx);
  const line: CartLine = {
    id: uuidv7(),
    item,
    quantity,
    listPrice: listPriceFor(item, quantity, ctx),
    override: null,
    discount: null,
    promotion: null,
  };
  return { ...cart, lines: [...cart.lines, line] };
}

export function setQuantity(cart: Cart, lineId: string, quantity: string, ctx: PriceContext): Cart {
  if (compare(quantity, "0") <= 0) return removeLine(cart, lineId);
  return {
    ...cart,
    lines: cart.lines.map((l) =>
      l.id === lineId ? { ...l, quantity, listPrice: listPriceFor(l.item, quantity, ctx) } : l,
    ),
  };
}

export function removeLine(cart: Cart, lineId: string): Cart {
  return { ...cart, lines: cart.lines.filter((l) => l.id !== lineId) };
}

export function overridePrice(cart: Cart, lineId: string, override: PriceOverride | null): Cart {
  return { ...cart, lines: cart.lines.map((l) => (l.id === lineId ? { ...l, override } : l)) };
}

export function setLineDiscount(cart: Cart, lineId: string, discount: LocalDiscount | null): Cart {
  return { ...cart, lines: cart.lines.map((l) => (l.id === lineId ? { ...l, discount } : l)) };
}

export function setPromotionsDisabled(cart: Cart, lineId: string, disabled: boolean): Cart {
  return { ...cart, lines: cart.lines.map((l) => (l.id === lineId ? { ...l, promotionsDisabled: disabled } : l)) };
}

export function setOrderDiscount(cart: Cart, discount: LocalDiscount | null): Cart {
  return { ...cart, orderDiscount: discount };
}

export function setCustomer(cart: Cart, customer: CartCustomer | null): Cart {
  return { ...cart, customerId: customer?.id ?? null, customer };
}

/** Re-resolve every list price (e.g. after switching price level). */
export function repriceAll(cart: Cart, ctx: PriceContext): Cart {
  return { ...cart, lines: cart.lines.map((l) => ({ ...l, listPrice: listPriceFor(l.item, l.quantity, ctx) })) };
}

/** Recompute which promotion applies to each line. Pure given `now`. */
export function applyPromotions(cart: Cart, promo: PromoContext | null, now: Date = new Date()): Cart {
  if (!promo || promo.promotions.length === 0) {
    return cart.lines.some((l) => l.promotion) ? { ...cart, lines: cart.lines.map((l) => ({ ...l, promotion: null })) } : cart;
  }
  const byId = new Map(promo.promotions.map((p) => [p.id, p]));
  const applied = evaluatePromotions(
    cart.lines.flatMap((l) => {
      const price = unitPrice(l);
      if (price === null || l.promotionsDisabled) return [];
      return [
        {
          lineId: l.id,
          variantId: l.item.variantId,
          productId: l.item.productId,
          categoryId: l.item.categoryId ?? null,
          brandId: l.item.brandId ?? null,
          quantity: l.quantity,
          unitPrice: price,
          hasManualDiscount: l.discount !== null,
        },
      ];
    }),
    promo.promotions,
    { now, timeZone: promo.timeZone, branchId: promo.branchId },
  );
  const byLine = new Map(applied.map((a) => [a.lineId, a]));
  return {
    ...cart,
    lines: cart.lines.map((l) => {
      const a = byLine.get(l.id);
      return {
        ...l,
        promotion: a ? { id: a.promotionId, name: byId.get(a.promotionId)?.name ?? "Promotion", discount: a.discount } : null,
      };
    }),
  };
}

export type CartTotals =
  | { ok: true; calculation: SaleCalculation }
  | { ok: false; error: string; calculation: null };

export function calculateCart(cart: Cart, pricesIncludeTax: boolean): CartTotals {
  if (cart.lines.length === 0) return { ok: false, error: "Cart is empty", calculation: null };
  const missing = cart.lines.find((l) => unitPrice(l) === null);
  if (missing) return { ok: false, error: `No price for ${missing.item.productName}`, calculation: null };
  try {
    return {
      ok: true,
      calculation: calculateSale(
        cart.lines.map((l) => ({
          quantity: l.quantity,
          unitPrice: unitPrice(l) ?? "0",
          taxRate: l.item.taxRate,
          taxKind: l.item.taxKind,
          discount: effectiveDiscount(l),
        })),
        { pricesIncludeTax, orderDiscount: cart.orderDiscount },
      ),
    };
  } catch (error) {
    if (error instanceof CalculationError) return { ok: false, error: error.message, calculation: null };
    throw error;
  }
}

export function itemCount(cart: Cart): string {
  return toQuantityString(add(...cart.lines.map((l) => l.quantity)));
}
