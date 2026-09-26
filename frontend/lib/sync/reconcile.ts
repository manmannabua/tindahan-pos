/**
 * Inventory reconciliation. See docs/INVENTORY_LEDGER.md §7 and SYNC_PROTOCOL.md §5.
 *
 *   local quantity = last server balance + provisional movements the server hasn't counted yet
 *
 * A provisional movement is "counted" once its sale was acknowledged AND a pull pass that started
 * after the acknowledgment has completed (that pass carried the updated balance).
 */
import { add, toQuantityString } from "@/lib/money";
import type { PosDatabase } from "@/lib/db/schema";

type Key = [stockLocationId: string, variantId: string];

/** Recompute `quantity` for the given (location, variant) keys (or all rows). */
export async function recomputeInventory(db: PosDatabase, keys?: Key[]): Promise<void> {
  const rows = keys ? (await db.inventory.bulkGet(keys)).filter((r) => r !== undefined) : await db.inventory.toArray();
  for (const row of rows) {
    const movements = await db.inventoryMovements
      .where("[stockLocationId+variantId]")
      .equals([row.stockLocationId, row.variantId])
      .toArray();
    const quantity = toQuantityString(add(row.serverQuantity, ...movements.map((m) => m.signedQuantity)));
    if (quantity !== row.quantity) {
      await db.inventory.update([row.stockLocationId, row.variantId], { quantity });
    }
  }
}

/**
 * After a completed pull pass that started at `passStartedAt`: drop provisional movements the
 * server balance now includes, then recompute the affected rows.
 */
export async function dropCountedMovements(db: PosDatabase, passStartedAt: string): Promise<number> {
  return db.transaction("rw", db.inventoryMovements, db.inventory, async () => {
    const counted = await db.inventoryMovements
      .filter((m) => m.ackedAt !== null && m.ackedAt < passStartedAt)
      .toArray();
    if (counted.length === 0) return 0;
    await db.inventoryMovements.bulkDelete(counted.map((m) => m.id));
    const keys = [...new Map(counted.map((m) => [`${m.stockLocationId}|${m.variantId}`, [m.stockLocationId, m.variantId] as Key])).values()];
    await recomputeInventory(db, keys);
    return counted.length;
  });
}

/** Apply a local provisional movement to the inventory snapshot (inside the caller's transaction). */
export async function applyLocalMovement(db: PosDatabase, stockLocationId: string, variantId: string, signedQuantity: string, now: string): Promise<void> {
  const key: Key = [stockLocationId, variantId];
  const row = await db.inventory.get(key);
  if (row) {
    await db.inventory.update(key, { quantity: toQuantityString(add(row.quantity, signedQuantity)) });
  } else {
    await db.inventory.put({
      stockLocationId,
      variantId,
      serverQuantity: "0",
      quantity: toQuantityString(signedQuantity),
      updatedAt: now,
    });
  }
}
