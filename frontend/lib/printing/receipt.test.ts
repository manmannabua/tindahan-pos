import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PosDatabase } from "@/lib/db/schema";
import { loadPosContext } from "@/lib/db/context";
import { addItem, EMPTY_CART } from "@/lib/pos/cart";
import { completeSale } from "@/lib/pos/complete-sale";
import { loadReceipt } from "@/lib/pos/receipts";
import { coke, createTerminalDb, destroyDb, IDS, PRICE_CONTEXT } from "@/test-utils/terminal-fixture";

import { renderReceiptHtml } from "./print";
import { COLUMNS, layoutReceipt, wrap } from "./receipt";

let db: PosDatabase;
beforeEach(async () => {
  db = await createTerminalDb();
});
afterEach(async () => {
  await destroyDb(db);
});

describe("wrap", () => {
  it("wraps words and hard-splits long ones", () => {
    expect(wrap("Sardines in tomato sauce 155g", 12)).toEqual(["Sardines in", "tomato sauce", "155g"]);
    expect(wrap("ABCDEFGHIJKLMNOP", 6)).toEqual(["ABCDEF", "GHIJKL", "MNOP"]);
  });
});

describe("receipt", () => {
  async function saleReceipt(width: 58 | 80, isReprint = false) {
    const cash = await db.paymentMethods.get(IDS.cash);
    if (!cash) throw new Error("missing");
    const { sale } = await completeSale(db, {
      cart: addItem(EMPTY_CART, { ...(await coke(db)), productName: "Very Long Product Name That Needs Wrapping On Small Paper" }, PRICE_CONTEXT),
      tenders: [{ method: cash, amount: "75.00", tendered: "100.00" }],
      cashier: { id: IDS.cashier, name: "Cathy" },
      cashSessionId: null,
      priceLevelId: IDS.retail,
      pricesIncludeTax: true,
      deviceId: IDS.device,
      receiptPrefix: "MAIN-T01-",
      stockLocationId: IDS.location,
    });
    const context = await loadPosContext(db);
    const doc = await loadReceipt(db, sale.id, { ...context, settings: { ...context.settings, receiptWidth: width } }, isReprint);
    if (!doc) throw new Error("no receipt");
    return doc;
  }

  it.each([58, 80] as const)("never exceeds the %i mm column width", async (width) => {
    const rows = layoutReceipt(await saleReceipt(width));
    for (const row of rows) expect(row.text.length).toBeLessThanOrEqual(COLUMNS[width]);
    const text = rows.map((r) => r.text).join("\n");
    expect(text).toContain("MAIN-T01-000001");
    expect(text).toMatch(/Change\s+25\.00/);
    expect(text).toMatch(/VATable sales\s+66\.96/);
    expect(text).toMatch(/VAT amount\s+8\.04/);
    expect(text).toContain("Salamat!");
  });

  it("marks reprints and escapes HTML", async () => {
    const doc = await saleReceipt(80, true);
    expect(layoutReceipt(doc).some((r) => r.text.includes("*** REPRINT ***"))).toBe(true);
    doc.lines.push({ kind: "text", text: "<script>alert(1)</script>" });
    const html = renderReceiptHtml(doc);
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("size: 80mm auto");
  });
});
