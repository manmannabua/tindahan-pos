/**
 * "Selling beyond local stock" warning. Never blocks the sale: the local quantity is an estimate
 * (other terminals may have sold offline) and the ledger flags real negatives on the server.
 */
import type { PosDatabase } from "@/lib/db/schema";
import { add, compare, multiply, toQuantityString } from "@/lib/money";

import type { Cart } from "./cart";

export interface StockShortfall {
  variantId: string;
  productName: string;
  inCart: string;
  onHand: string;
}

export async function checkStock(
  db: PosDatabase,
  cart: Cart,
  variantId: string,
  stockLocationId: string,
): Promise<StockShortfall | null> {
  const lines = cart.lines.filter((l) => l.item.variantId === variantId && l.item.trackInventory);
  if (lines.length === 0) return null;
  const inCart = add(...lines.map((l) => multiply(l.quantity, l.item.unitFactor)));
  const row = await db.inventory.get([stockLocationId, variantId]);
  const onHand = row?.quantity ?? "0";
  if (compare(inCart, onHand) <= 0) return null;
  return { variantId, productName: lines[0].item.productName, inCart: toQuantityString(inCart), onHand: toQuantityString(onHand) };
}
