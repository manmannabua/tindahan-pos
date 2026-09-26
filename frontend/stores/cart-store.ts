import { create } from "zustand";

import type { SellableItem } from "@/lib/db/catalog";
import type { LocalDiscount } from "@/lib/db/schema";
import {
  addItem,
  applyPromotions,
  EMPTY_CART,
  overridePrice,
  removeLine,
  repriceAll,
  setCustomer,
  setLineDiscount,
  setOrderDiscount,
  setPromotionsDisabled,
  setQuantity,
  type Cart,
  type CartCustomer,
  type PriceContext,
  type PriceOverride,
  type PromoContext,
} from "@/lib/pos/cart";

interface CartState extends Cart {
  priceContext: PriceContext | null;
  promoContext: PromoContext | null;
  /** Id of the most recently touched line (highlight / keyboard target). */
  activeLineId: string | null;
  setPriceContext: (ctx: PriceContext) => void;
  setPromoContext: (ctx: PromoContext | null) => void;
  add: (item: SellableItem, quantity?: string) => void;
  setQuantity: (lineId: string, quantity: string) => void;
  remove: (lineId: string) => void;
  overridePrice: (lineId: string, override: PriceOverride | null) => void;
  setLineDiscount: (lineId: string, discount: LocalDiscount | null) => void;
  setPromotionsDisabled: (lineId: string, disabled: boolean) => void;
  setOrderDiscount: (discount: LocalDiscount | null) => void;
  /** Select a customer; their price level (if any) re-prices the cart. */
  setCustomer: (customer: CartCustomer | null) => void;
  replace: (cart: Cart) => void;
  clear: () => void;
}

function requireCtx(ctx: PriceContext | null): PriceContext {
  if (!ctx) throw new Error("Cart price context is not set");
  return ctx;
}

type State = CartState;

/** Every mutation ends here: promotions depend on quantities, prices and manual discounts. */
function withPromos(state: State, next: Cart): Cart {
  return applyPromotions(next, state.promoContext);
}

/** The cart being built. Checkpointed to IndexedDB (features/pos/hooks/use-cart-checkpoint). */
export const useCartStore = create<CartState>()((set) => ({
  ...EMPTY_CART,
  priceContext: null,
  promoContext: null,
  activeLineId: null,
  setPriceContext: (ctx) =>
    set((s) => ({ ...withPromos(s, repriceAll(cartSnapshot(s), ctx)), priceContext: ctx })),
  setPromoContext: (promoContext) =>
    set((s) => ({ ...applyPromotions(cartSnapshot(s), promoContext), promoContext })),
  add: (item, quantity = "1") =>
    set((s) => {
      const next = withPromos(s, addItem(s, item, requireCtx(s.priceContext), quantity));
      const touched =
        next.lines.find(
          (l) => l.item.variantId === item.variantId && l.item.productUnitId === item.productUnitId && !l.override && !l.discount,
        ) ?? next.lines.at(-1);
      return { ...next, activeLineId: touched?.id ?? null };
    }),
  setQuantity: (lineId, quantity) =>
    set((s) => ({ ...withPromos(s, setQuantity(s, lineId, quantity, requireCtx(s.priceContext))), activeLineId: lineId })),
  remove: (lineId) => set((s) => withPromos(s, removeLine(s, lineId))),
  overridePrice: (lineId, override) => set((s) => withPromos(s, overridePrice(s, lineId, override))),
  setLineDiscount: (lineId, discount) => set((s) => withPromos(s, setLineDiscount(s, lineId, discount))),
  setPromotionsDisabled: (lineId, disabled) => set((s) => withPromos(s, setPromotionsDisabled(s, lineId, disabled))),
  setOrderDiscount: (discount) => set((s) => setOrderDiscount(s, discount)),
  setCustomer: (customer) =>
    set((s) => {
      const base = requireCtx(s.priceContext);
      const ctx = { ...base, priceLevelId: customer?.priceLevelId ?? base.defaultPriceLevelId };
      return { ...withPromos(s, repriceAll(setCustomer(s, customer), ctx)), priceContext: ctx };
    }),
  replace: (cart) =>
    set((s) => {
      const base = s.priceContext;
      const ctx = base ? { ...base, priceLevelId: cart.customer?.priceLevelId ?? base.defaultPriceLevelId } : null;
      return { ...withPromos(s, { ...EMPTY_CART, ...cart }), priceContext: ctx, activeLineId: null };
    }),
  clear: () =>
    set((s) => ({
      ...EMPTY_CART,
      activeLineId: null,
      priceContext: s.priceContext ? { ...s.priceContext, priceLevelId: s.priceContext.defaultPriceLevelId } : null,
    })),
}));

export function cartSnapshot(state: Cart): Cart {
  return {
    lines: state.lines,
    orderDiscount: state.orderDiscount,
    customerId: state.customerId,
    customer: state.customer ?? null,
  };
}
