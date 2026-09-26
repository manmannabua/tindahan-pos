"use client";

import { useEffect, useRef } from "react";

import { getDb } from "@/lib/db/schema";
import type { Cart } from "@/lib/pos/cart";
import { cartSnapshot, useCartStore } from "@/stores/cart-store";

const DEBOUNCE_MS = 300;

/**
 * Crash-safety for the cart being built (docs/OFFLINE_ARCHITECTURE.md §5): restore the IndexedDB
 * checkpoint on mount, then write every change (debounced). Completing a sale deletes the
 * checkpoint inside the sale transaction, so a completed cart is never restored.
 */
export function useCartCheckpoint(enabled: boolean): void {
  const restored = useRef(false);

  useEffect(() => {
    if (!enabled || restored.current) return;
    restored.current = true;
    void getDb()
      .activeCart.get("current")
      .then(async (row) => {
        const cart = row?.cart as Cart | undefined;
        if (cart && !(await isCompleted(cart)) && useCartStore.getState().lines.length === 0) {
          useCartStore.getState().replace(cart);
        }
      });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = useCartStore.subscribe((state, previous) => {
      if (state.lines === previous.lines && state.orderDiscount === previous.orderDiscount) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void writeCheckpoint(cartSnapshot(useCartStore.getState()));
      }, DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [enabled]);
}

/** Cart line ids become sale item ids, so a cart whose first line is a sale item was completed. */
async function isCompleted(cart: Cart): Promise<boolean> {
  const first = cart.lines[0];
  return !first || (await getDb().saleItems.get(first.id)) !== undefined;
}

async function writeCheckpoint(cart: Cart): Promise<void> {
  const db = getDb();
  await db.transaction("rw", db.activeCart, db.saleItems, async () => {
    if (await isCompleted(cart)) await db.activeCart.delete("current");
    else await db.activeCart.put({ id: "current", cart, updatedAt: new Date().toISOString() });
  });
}