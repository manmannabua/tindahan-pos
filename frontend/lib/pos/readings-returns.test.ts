/**
 * Terminal X/Z readings (grand total, Z counter, v3 seed) and returns of sales found online.
 */
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api/errors";
import { getMeta } from "@/lib/db/meta";
import { PosDatabase, type LocalSale } from "@/lib/db/schema";
import { buildReadingDocument } from "@/lib/printing/reading";
import { COLUMNS, layoutReceipt } from "@/lib/printing/receipt";
import { coke, createTerminalDb, destroyDb, IDS, PRICE_CONTEXT } from "@/test-utils/terminal-fixture";
import type { ReturnCreatePayload, SaleLookupResponse } from "@/types/sync";

import { addItem, EMPTY_CART, setQuantity } from "./cart";
import { completeSale } from "./complete-sale";
import { computeReading, xReading, zReading } from "./readings";
import { findSaleForReturn } from "./sale-lookup";
import { createReturn, remoteReturnableLines, remoteSaleFromLookup, voidSale } from "./voids-returns";

let db: PosDatabase;
beforeEach(async () => {
  db = await createTerminalDb();
});
afterEach(async () => {
  await destroyDb(db);
});

async function cash() {
  const m = await db.paymentMethods.get(IDS.cash);
  if (!m) throw new Error("missing");
  return m;
}

async function sellCokes(quantity: string, now: Date) {
  let cart = addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT);
  cart = setQuantity(cart, cart.lines[0].id, quantity, PRICE_CONTEXT);
  const amount = (75 * Number(quantity)).toFixed(2);
  return completeSale(db, {
    cart,
    tenders: [{ method: await cash(), amount, tendered: amount }],
    cashier: { id: IDS.cashier, name: "Cathy" },
    cashSessionId: null,
    priceLevelId: IDS.retail,
    pricesIncludeTax: true,
    deviceId: IDS.device,
    receiptPrefix: "MAIN-T01-",
    stockLocationId: IDS.location,
    now,
  });
}

const at = (hour: number) => new Date(`2026-09-26T${String(hour).padStart(2, "0")}:00:00Z`);

describe("terminal readings", () => {
  it("keeps a non-resettable grand total: sales add, voids subtract", async () => {
    await sellCokes("1", at(1));
    const second = await sellCokes("2", at(2));
    expect(await getMeta(db, "grandTotal")).toBe("225.00");
    await voidSale(db, { saleId: second.sale.id, voidedById: IDS.manager, authorizedById: IDS.manager, reason: "wrong item", deviceId: IDS.device, now: at(3) });
    expect(await getMeta(db, "grandTotal")).toBe("75.00");

    const x = await xReading(db, null, at(4));
    expect(x).toMatchObject({
      kind: "X",
      transactions: 1,
      grossSales: "75.00",
      netSales: "75.00",
      voidsCount: 1,
      voidsAmount: "150.00",
      vatableSales: "66.96",
      vatAmount: "8.04",
      firstReceipt: "MAIN-T01-000001",
      lastReceipt: "MAIN-T01-000002",
      oldGrandTotal: "0.00",
      newGrandTotal: "75.00",
      payments: [{ kind: "CASH", amount: "75.00" }],
    });
    // An X-reading changes nothing.
    expect(await getMeta(db, "zCount")).toBeUndefined();
  });

  it("numbers Z-readings and never covers a sale twice", async () => {
    await sellCokes("1", at(1));
    const z1 = await zReading(db, at(2));
    expect(z1).toMatchObject({ kind: "Z", zNumber: 1, from: null, transactions: 1, oldGrandTotal: "0.00", newGrandTotal: "75.00" });

    await sellCokes("2", at(3));
    const z2 = await zReading(db, at(4));
    expect(z2).toMatchObject({ zNumber: 2, from: at(2).toISOString(), transactions: 1, netSales: "150.00", oldGrandTotal: "75.00", newGrandTotal: "225.00" });

    const z3 = await zReading(db, at(5));
    expect(z3).toMatchObject({ zNumber: 3, transactions: 0, netSales: "0.00", oldGrandTotal: "225.00", newGrandTotal: "225.00" });
    expect(await getMeta(db, "zCount")).toBe(3);
    expect(await getMeta(db, "lastZGrandTotal")).toBe("225.00");
  });

  it.each([58, 80] as const)("prints a reading slip within %i mm", async (width) => {
    await sellCokes("1", at(1));
    const reading = await computeReading(db, { kind: "Z", from: null, to: at(2).toISOString(), zNumber: 7 });
    const context = { company: { id: IDS.company, code: "ACME", name: "Acme Mart", legalName: null, tin: "123-456", currency: "PHP", timezone: "Asia/Manila", pricesIncludeTax: true, settings: {} }, branch: { id: IDS.branch, code: "MAIN", name: "Main", address: "1 Rizal St", phone: null, tin: null, receiptHeader: null, receiptFooter: null, isActive: true } };
    const doc = buildReadingDocument(reading, { ...context, terminalCode: "T01", deviceBir: { min: "MIN-1", serialNumber: null, ptuNumber: null, ptuIssuedOn: null }, printedBy: "Mara", width });
    const rows = layoutReceipt(doc);
    for (const row of rows) expect(row.text.length).toBeLessThanOrEqual(COLUMNS[width]);
    const text = rows.map((r) => r.text).join("\n");
    expect(text).toContain("Z-READING #7");
    expect(text).toContain("MIN: MIN-1");
    expect(text).toMatch(/New grand total\s+75\.00/);
    expect(text).toMatch(/Cash\s+75\.00/);
  });

  it("v3 upgrade seeds the grand total from completed sales already on the terminal", async () => {
    const name = `upgrade-${crypto.randomUUID()}`;
    // Build a v2 database with the same stores, holding one completed and one voided sale.
    const current = new PosDatabase(`probe-${crypto.randomUUID()}`);
    const stores = Object.fromEntries(
      current.tables.map((t) => [t.name, [t.schema.primKey.src, ...t.schema.indexes.map((i) => i.src)].join(", ")]),
    );
    const old = new Dexie(name);
    old.version(2).stores(stores);
    await old.open();
    const base = { id: "s1", receiptNumber: "R1", status: "COMPLETED", total: "100.50" } as Partial<LocalSale>;
    await old.table("sales").bulkAdd([base, { ...base, id: "s2", receiptNumber: "R2", total: "40.00", status: "VOIDED" }, { ...base, id: "s3", receiptNumber: "R3", total: "9.50" }]);
    old.close();

    const upgraded = new PosDatabase(name);
    await upgraded.open();
    expect(await getMeta(upgraded, "grandTotal")).toBe("110.00");
    upgraded.close();
    await upgraded.delete();
    await current.delete();
  });
});

// --- returns across terminals -------------------------------------------------------------------

const LOOKUP: SaleLookupResponse = {
  sale: {
    id: "01920000-0000-7000-8000-00000000aaaa",
    receipt_number: "MAIN-T02-000009",
    status: "COMPLETED",
    total: "225.00",
    occurred_at: "2026-09-26T01:00:00Z",
    items: [
      {
        id: "01920000-0000-7000-8000-00000000bbbb",
        line_no: 1,
        variant_id: IDS.cokeVariant,
        product_name: "Coke 1.5L",
        variant_name: null,
        sku: "COKE15",
        unit_code: "PC",
        quantity: "3.000",
        base_quantity: "3.000",
        unit_price: "75.00",
        total: "200.00",
      },
    ],
  },
  returned_quantities: { "01920000-0000-7000-8000-00000000bbbb": "1.000" },
};

describe("return lookup", () => {
  it("finds local sales first, without the network", async () => {
    const { sale } = await sellCokes("1", at(1));
    const request = vi.fn();
    const found = await findSaleForReturn(db, " main-t01-000001 ", { online: true, client: { request } });
    expect(found).toEqual({ kind: "local", sale });
    expect(request).not.toHaveBeenCalled();
  });

  it("looks up other terminals' sales online; reports offline and not-found", async () => {
    const request = vi.fn().mockResolvedValueOnce(LOOKUP);
    const found = await findSaleForReturn(db, "MAIN-T02-000009", { online: true, client: { request } });
    expect(request).toHaveBeenCalledWith("/sync/sales/lookup", { query: { receipt_number: "MAIN-T02-000009" } });
    expect(found.kind).toBe("remote");

    expect(await findSaleForReturn(db, "MAIN-T02-000009", { online: false, client: { request } })).toEqual({ kind: "offline" });
    request.mockRejectedValueOnce(new ApiError(404, "sync.sale_not_found", "Not found"));
    expect(await findSaleForReturn(db, "NOPE", { online: true, client: { request } })).toEqual({ kind: "not_found" });
    request.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await findSaleForReturn(db, "NOPE", { online: true, client: { request } })).toEqual({ kind: "offline" });
  });

  it("uses the server's exact refunded amount when the lookup reports it", async () => {
    // Earlier return on another terminal refunded 66.66 (not the 66.67 pro-rata estimate).
    const remote = remoteSaleFromLookup({
      ...LOOKUP,
      refunded_amounts: { "01920000-0000-7000-8000-00000000bbbb": "66.66" },
    });
    const [line] = await remoteReturnableLines(db, remote);
    expect(line).toMatchObject({ remainingQuantity: "2", returnedRefund: "66.66" });
  });

  it("returns a remote sale: server-returned quantity counts, stock goes to this terminal's location", async () => {
    const remote = remoteSaleFromLookup(LOOKUP);
    const [line] = await remoteReturnableLines(db, remote);
    expect(line).toMatchObject({ returnedQuantity: "1", remainingQuantity: "2", returnedRefund: "66.67" });

    const created = await createReturn(db, {
      saleId: remote.saleId,
      remote,
      restockLocationId: IDS.location,
      lines: [{ saleItemId: line.item.id, quantity: "1", restock: true }],
      refunds: [{ method: await cash(), amount: "66.67" }],
      cashier: { id: IDS.cashier, name: "Cathy" },
      authorizedById: IDS.manager,
      reason: "damaged",
      cashSessionId: null,
      deviceId: IDS.device,
      receiptPrefix: "MAIN-T01-",
    });
    const payload = created.payload as ReturnCreatePayload;
    expect(payload).toMatchObject({ sale_id: LOOKUP.sale.id, items: [{ sale_item_id: line.item.id, quantity: "1", restock: true }] });
    expect((await db.inventory.get([IDS.location, IDS.cokeVariant]))?.quantity).toBe("11");

    // The unsynced local return is counted too: only 1 left, refunded as the exact remainder.
    const [after] = await remoteReturnableLines(db, remote);
    expect(after.remainingQuantity).toBe("1");
    await expect(
      createReturn(db, {
        saleId: remote.saleId,
        remote,
        restockLocationId: IDS.location,
        lines: [{ saleItemId: line.item.id, quantity: "2", restock: false }],
        refunds: [{ method: await cash(), amount: "133.33" }],
        cashier: { id: IDS.cashier, name: "Cathy" },
        authorizedById: IDS.manager,
        reason: "damaged",
        cashSessionId: null,
        deviceId: IDS.device,
        receiptPrefix: "MAIN-T01-",
      }),
    ).rejects.toThrow("Only 1 of Coke 1.5L can still be returned");
  });
});
