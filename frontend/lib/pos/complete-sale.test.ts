import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lookupBarcode } from "@/lib/db/catalog";
import { getMeta } from "@/lib/db/meta";
import type { PosDatabase } from "@/lib/db/schema";
import { coke, createTerminalDb, destroyDb, IDS, PRICE_CONTEXT } from "@/test-utils/terminal-fixture";
import type { SaleCompletePayload } from "@/types/sync";

import { addItem, EMPTY_CART, setOrderDiscount, type Cart } from "./cart";
import { completeSale, derivedId, SaleValidationError, type CompleteSaleArgs, type TenderInput } from "./complete-sale";

let db: PosDatabase;

beforeEach(async () => {
  db = await createTerminalDb();
});
afterEach(async () => {
  await destroyDb(db);
});

async function method(id: string) {
  const m = await db.paymentMethods.get(id);
  if (!m) throw new Error("missing method");
  return m;
}

async function args(cart: Cart, tenders: TenderInput[]): Promise<CompleteSaleArgs> {
  return {
    cart,
    tenders,
    cashier: { id: IDS.cashier, name: "Cathy Cashier" },
    cashSessionId: "cs000000-0000-7000-8000-000000000001",
    priceLevelId: IDS.retail,
    pricesIncludeTax: true,
    deviceId: IDS.device,
    receiptPrefix: "MAIN-T01-",
    stockLocationId: IDS.location,
    now: new Date("2026-09-26T08:00:00Z"),
  };
}

describe("derivedId", () => {
  it("matches the backend's uuid5 derived_id (value computed with Python)", () => {
    expect(derivedId("01920000-0000-7000-8000-000000000001", "SALE")).toBe("958b5b37-2da3-54b2-a641-0825ce207e04");
  });
});

describe("completeSale", () => {
  it("scan → cart → complete writes every table in one transaction, with no network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const scanned = await lookupBarcode(db, "4800361419116");
    expect(scanned.status).toBe("found");
    if (scanned.status !== "found") return;
    let cart = addItem(EMPTY_CART, scanned.item, PRICE_CONTEXT);
    cart = addItem(cart, scanned.item, PRICE_CONTEXT); // same item → quantity 2
    const box = await coke(db, "box");
    cart = addItem(cart, box, PRICE_CONTEXT);
    expect(cart.lines.map((l) => l.quantity)).toEqual(["2", "1"]);

    const result = await completeSale(db, await args(cart, [{ method: await method(IDS.cash), amount: "1000.00", tendered: "1000.00" }]));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.sale.receiptNumber).toBe("MAIN-T01-000001");
    expect(result.sale.total).toBe("1000.00"); // 2 × 75 + 850
    expect(result.sale.changeTotal).toBe("0.00");
    expect(await db.sales.count()).toBe(1);
    expect(await db.saleItems.count()).toBe(2);
    expect(await db.payments.count()).toBe(1);
    expect(await getMeta(db, "receiptSeq")).toBe(1);

    // Provisional ledger: 2 PC + 1 BOX (12 PC) = 14 PC out of 10 on hand → -4 locally.
    const movements = await db.inventoryMovements.toArray();
    expect(movements.map((m) => m.signedQuantity).sort()).toEqual(["-12", "-2"]);
    expect(movements.map((m) => m.id).sort()).toEqual(result.items.map((i) => derivedId(i.id, "SALE")).sort());
    const stock = await db.inventory.get([IDS.location, IDS.cokeVariant]);
    expect(stock?.quantity).toBe("-4");
    expect(stock?.serverQuantity).toBe("10.000");

    const [op] = await db.outbox.toArray();
    expect(op).toMatchObject({ operation: "sale.complete", entityType: "sale", entityId: result.sale.id, priority: 10, status: "PENDING" });
    const payload = op.payload as SaleCompletePayload;
    expect(payload).toMatchObject({
      schema_version: 1,
      id: result.sale.id,
      receipt_number: "MAIN-T01-000001",
      cashier_id: IDS.cashier,
      price_level_id: IDS.retail,
      prices_include_tax: true,
      totals: { total: "1000.00", paid_total: "1000.00", change_total: "0.00", tax_total: "107.14" },
    });
    expect(payload.items[1]).toMatchObject({ unit_code: "BOX", unit_factor: "12.000000", quantity: "1", unit_price: "850.00", tax_rate: "12.000", tax_kind: "VATABLE", total: "850.00" });
    expect(payload.payments[0]).toMatchObject({ payment_method_id: IDS.cash, amount: "1000.00", tendered: "1000.00", reference_no: null });
  });

  it("gives change for cash and needs references for e-wallets", async () => {
    const cart = addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT);
    await expect(
      completeSale(db, await args(cart, [{ method: await method(IDS.gcash), amount: "75.00" }])),
    ).rejects.toBeInstanceOf(SaleValidationError);

    const result = await completeSale(
      db,
      await args(cart, [
        { method: await method(IDS.gcash), amount: "50.00", referenceNo: "GC-1" },
        { method: await method(IDS.cash), amount: "25.00", tendered: "100.00" },
      ]),
    );
    expect(result.sale.changeTotal).toBe("75.00");
    expect(result.payments.map((p) => [p.methodKind, p.change])).toEqual([
      ["EWALLET", "0.00"],
      ["CASH", "75.00"],
    ]);
  });

  it("rejects underpayment and writes nothing", async () => {
    const cart = addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT);
    await expect(completeSale(db, await args(cart, [{ method: await method(IDS.cash), amount: "70.00" }]))).rejects.toThrow(
      SaleValidationError,
    );
    expect(await db.sales.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("rolls back everything if the transaction fails midway", async () => {
    const cart = addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT);
    vi.spyOn(db.outbox, "add").mockRejectedValueOnce(new Error("disk full"));
    await expect(completeSale(db, await args(cart, [{ method: await method(IDS.cash), amount: "75.00" }]))).rejects.toThrow("disk full");
    expect(await db.sales.count()).toBe(0);
    expect(await db.saleItems.count()).toBe(0);
    expect(await db.payments.count()).toBe(0);
    expect(await db.inventoryMovements.count()).toBe(0);
    expect((await db.inventory.get([IDS.location, IDS.cokeVariant]))?.quantity).toBe("10");
    expect(await getMeta(db, "receiptSeq")).toBe(0);
  });

  it("allocates an order discount and numbers receipts sequentially", async () => {
    let cart = addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT);
    cart = setOrderDiscount(cart, { kind: "PERCENT", value: "10", reason: "promo", authorizedById: IDS.manager });
    const first = await completeSale(db, await args(cart, [{ method: await method(IDS.cash), amount: "67.50" }]));
    expect(first.payload.order_discount).toEqual({ kind: "PERCENT", value: "10.00", reason: "promo", authorized_by_id: IDS.manager });
    expect(first.payload.items[0].order_discount_share).toBe("7.50");
    const second = await completeSale(db, await args(addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT), [{ method: await method(IDS.cash), amount: "75.00" }]));
    expect(second.sale.receiptNumber).toBe("MAIN-T01-000002");
  });
});
