/**
 * A sale and its later void share the sale id as movement reference: acknowledging one operation
 * must only mark ITS movements as counted by the server (reconciliation relies on this).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PosDatabase } from "@/lib/db/schema";
import { addItem, EMPTY_CART } from "@/lib/pos/cart";
import { completeSale } from "@/lib/pos/complete-sale";
import { createReturn, voidSale } from "@/lib/pos/voids-returns";
import { coke, createTerminalDb, destroyDb, IDS, PRICE_CONTEXT } from "@/test-utils/terminal-fixture";
import type { OpStatus, PushRequest, PushResponse } from "@/types/sync";

import { SyncEngine, type SyncTransport } from "./engine";

let db: PosDatabase;
const clock = new Date("2026-09-26T08:00:00Z");

beforeEach(async () => {
  db = await createTerminalDb();
});
afterEach(async () => {
  await destroyDb(db);
});

function transport(statusFor: (operation: string) => OpStatus): SyncTransport {
  return {
    push: vi.fn(async (req: PushRequest): Promise<PushResponse> => ({
      results: req.operations.map((op) => {
        const status = statusFor(op.operation);
        return {
          operation_id: op.operation_id,
          status,
          error: status === "APPLIED" ? null : { code: "sale.session_closed", message: "closed" },
          result: null,
        };
      }),
      server_time: clock.toISOString(),
    })),
    pull: vi.fn(async () => ({ changes: {}, staff: null, counts: null, next_cursor: "c", has_more: false, server_time: clock.toISOString() })),
  };
}

async function saleThenVoid() {
  const cash = await db.paymentMethods.get(IDS.cash);
  if (!cash) throw new Error("no cash");
  const { sale } = await completeSale(db, {
    cart: addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT),
    tenders: [{ method: cash, amount: "75.00" }],
    cashier: { id: IDS.cashier, name: "Cathy" },
    cashSessionId: null,
    priceLevelId: IDS.retail,
    pricesIncludeTax: true,
    deviceId: IDS.device,
    receiptPrefix: "MAIN-T01-",
    stockLocationId: IDS.location,
  });
  await voidSale(db, { saleId: sale.id, voidedById: IDS.cashier, authorizedById: null, reason: "Oops", deviceId: IDS.device });
  return sale;
}

describe("acknowledgment per operation", () => {
  it("acking sale.complete does not mark the void's movements; a rejected void keeps them pending", async () => {
    const sale = await saleThenVoid();
    const result = await new SyncEngine({ db, transport: transport((op) => (op === "sale.void" ? "REJECTED" : "APPLIED")), now: () => clock }).run();
    expect(result.pushed).toBeGreaterThanOrEqual(2);

    const movements = await db.inventoryMovements.where("referenceId").equals(sale.id).toArray();
    const byType = Object.fromEntries(movements.map((m) => [m.movementType, m.ackedAt]));
    expect(byType.SALE).not.toBeNull();
    expect(byType.SALE_VOID).toBeNull();
    expect((await db.sales.get(sale.id))?.syncStatus).toBe("SYNCED"); // the void's rejection doesn't mark the sale
    const [voidOp] = await db.outbox.filter((o) => o.operation === "sale.void").toArray();
    expect(voidOp.status).toBe("FAILED");
  });

  it("marks returns SYNCED and their movements acknowledged", async () => {
    const cash = await db.paymentMethods.get(IDS.cash);
    if (!cash) throw new Error("no cash");
    const { sale, items } = await completeSale(db, {
      cart: addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT),
      tenders: [{ method: cash, amount: "75.00" }],
      cashier: { id: IDS.cashier, name: "Cathy" },
      cashSessionId: null,
      priceLevelId: IDS.retail,
      pricesIncludeTax: true,
      deviceId: IDS.device,
      receiptPrefix: "MAIN-T01-",
      stockLocationId: IDS.location,
    });
    const { ret } = await createReturn(db, {
      saleId: sale.id,
      lines: [{ saleItemId: items[0].id, quantity: "1", restock: true }],
      refunds: [{ method: cash, amount: "75.00" }],
      cashier: { id: IDS.cashier, name: "Cathy" },
      authorizedById: null,
      reason: "Broken",
      cashSessionId: null,
      deviceId: IDS.device,
      receiptPrefix: "MAIN-T01-",
    });
    await new SyncEngine({ db, transport: transport(() => "APPLIED"), now: () => clock }).run();
    expect((await db.returns.get(ret.id))?.syncStatus).toBe("SYNCED");
    const returnMovements = await db.inventoryMovements.where("referenceId").equals(ret.id).toArray();
    expect(returnMovements.every((m) => m.ackedAt !== null)).toBe(true);
  });
});
