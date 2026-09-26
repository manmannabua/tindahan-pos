import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PosDatabase } from "@/lib/db/schema";
import { coke, createTerminalDb, destroyDb, IDS, PRICE_CONTEXT } from "@/test-utils/terminal-fixture";
import type { CashSessionClosePayload } from "@/types/sync";

import { addItem, EMPTY_CART } from "./cart";
import { closeCashSession, getOpenSession, openCashSession, recordCashMovement } from "./cash-session";
import { completeSale } from "./complete-sale";

let db: PosDatabase;
beforeEach(async () => {
  db = await createTerminalDb();
});
afterEach(async () => {
  await destroyDb(db);
});

describe("cash sessions", () => {
  it("expected cash = float + cash applied + cash in − cash out − pickups (GCash excluded)", async () => {
    const session = await openCashSession(db, { deviceId: IDS.device, userId: IDS.cashier, openingFloat: "500" });
    await expect(openCashSession(db, { deviceId: IDS.device, userId: IDS.cashier, openingFloat: "1" })).rejects.toThrow();
    const [cash, gcash] = await Promise.all([db.paymentMethods.get(IDS.cash), db.paymentMethods.get(IDS.gcash)]);
    if (!cash || !gcash) throw new Error("missing");
    const item = await coke(db);
    const base = {
      cashier: { id: IDS.cashier, name: "Cathy" },
      cashSessionId: session.id,
      priceLevelId: IDS.retail,
      pricesIncludeTax: true,
      deviceId: IDS.device,
      receiptPrefix: "MAIN-T01-",
      stockLocationId: IDS.location,
    };
    await completeSale(db, { ...base, cart: addItem(EMPTY_CART, item, PRICE_CONTEXT), tenders: [{ method: cash, amount: "75.00", tendered: "100.00" }] });
    await completeSale(db, { ...base, cart: addItem(EMPTY_CART, item, PRICE_CONTEXT), tenders: [{ method: gcash, amount: "75.00", referenceNo: "G1" }] });
    await recordCashMovement(db, { deviceId: IDS.device, sessionId: session.id, type: "CASH_IN", amount: "20", reason: "coins", userId: IDS.cashier, authorizedById: IDS.manager });
    await recordCashMovement(db, { deviceId: IDS.device, sessionId: session.id, type: "PICKUP", amount: "300", reason: null, userId: IDS.cashier, authorizedById: null });

    const summary = await closeCashSession(db, { deviceId: IDS.device, sessionId: session.id, userId: IDS.cashier, countedCash: "294.00", note: null });
    expect(summary.expectedCash).toBe("295.00"); // 500 + 75 + 20 − 300
    expect(summary.session).toMatchObject({ status: "CLOSED", overShort: "-1.00" });
    expect(summary.byMethod.map((m) => [m.name, m.amount])).toEqual([
      ["Cash", "75.00"],
      ["GCash", "75.00"],
    ]);
    expect(await getOpenSession(db)).toBeUndefined();

    const ops = await db.outbox.orderBy("seq").toArray();
    expect(ops.map((o) => [o.operation, o.priority])).toEqual([
      ["cash_session.open", 5],
      ["sale.complete", 10],
      ["sale.complete", 10],
      ["cash_movement.record", 40],
      ["cash_movement.record", 40],
      ["cash_session.close", 40],
    ]);
    expect(ops.at(-1)?.payload as CashSessionClosePayload).toMatchObject({ counted_cash: "294.00", expected_cash: "295.00", over_short: "-1.00" });
  });
});
