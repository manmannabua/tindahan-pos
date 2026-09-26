"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import { lookupBarcode, loadSellable } from "@/lib/db/catalog";
import { getDb } from "@/lib/db/schema";
import { beep } from "@/lib/pos/feedback";
import { checkStock } from "@/lib/pos/stock-check";
import { useCartStore } from "@/stores/cart-store";
import { usePosSession } from "@/stores/pos-session-store";
import { usePosFeature } from "./use-pos-feature";

export type ScanOutcome = "added" | "not_found" | "inactive";

/**
 * Scan → IndexedDB → cart. No network anywhere on this path (docs/BARCODE_SCANNER.md §5).
 * Returns the outcome so the caller can open the search panel for unknown codes.
 */
export function useScanToCart(): {
  scan: (code: string) => Promise<ScanOutcome>;
  addVariant: (variantId: string) => Promise<void>;
} {
  const sound = usePosSession((s) => s.context?.settings.scannerSound ?? true);
  const inventoryOn = usePosFeature("inventory");
  const warnStock = usePosSession((s) => s.context?.settings.warnOnNegativeStock ?? true) && inventoryOn;
  const locationId = usePosSession((s) => s.context?.device.defaultStockLocationId ?? null);

  const warnIfShort = useCallback(
    async (variantId: string) => {
      if (!warnStock || !locationId) return;
      const short = await checkStock(getDb(), useCartStore.getState(), variantId, locationId);
      if (short) {
        toast.warning(`${short.productName}: ${short.inCart} in cart, only ${short.onHand} in stock (local estimate)`, {
          id: `stock-${variantId}`,
        });
      }
    },
    [warnStock, locationId],
  );

  const scan = useCallback(
    async (code: string): Promise<ScanOutcome> => {
      const result = await lookupBarcode(getDb(), code);
      if (result.status === "found") {
        useCartStore.getState().add(result.item);
        beep("ok", sound);
        void warnIfShort(result.item.variantId);
        return "added";
      }
      beep("error", sound);
      if (result.status === "inactive") {
        toast.error(`${result.name} is not for sale (inactive)`);
        return "inactive";
      }
      toast.error(`Not found: ${result.code}`);
      return "not_found";
    },
    [sound, warnIfShort],
  );

  const addVariant = useCallback(
    async (variantId: string) => {
      const item = await loadSellable(getDb(), variantId);
      if (!item) {
        beep("error", sound);
        toast.error("Product is not available on this terminal");
        return;
      }
      useCartStore.getState().add(item);
      beep("ok", sound);
      void warnIfShort(item.variantId);
    },
    [sound, warnIfShort],
  );

  return { scan, addVariant };
}
