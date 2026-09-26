/**
 * Phase 7 on the terminal: promotions in the cart, customers, voids, returns, expected cash,
 * stock warnings and terminal settings — all local (IndexedDB), no network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_SETTINGS, getMeta, getTerminalSettings, saveTerminalSettings } from "@/lib/db/meta";
import type { PosDatabase } from "@/lib/db/schema";
import type { PromoDef } from "@/lib/promotions/evaluate";
import { coke, createTerminalDb, destroyDb, IDS, PRICE_CONTEXT } from "@/test-utils/terminal-fixture";
import { useCartStore } from "@/stores/cart-store";
import type { CustomerUpsertPayload, ReturnCreatePayload, SaleCompletePayload, SaleVoidPayload } from "@/types/sync";

import { addItem, applyPromotions, calculateCart, EMPTY_CART, setLineDiscount, setPromotionsDisabled, setQuantity, type Cart, type PromoContext } from "./cart";
import { closeCashSession, openCashSession, summarizeSession } from "./cash-session";
import { completeSale, derivedId } from "./complete-sale";
import { createCustomerOffline, normalizePhone, searchCustomers } from "./customers";
import { checkStock } from "./stock-check";
import { computeRefunds, createReturn, returnableLines, ReturnVoidError, voidSale } from "./voids-returns";

let db: PosDatabase;
beforeEach(async () => {
  db = await createTerminalDb();
});
afterEach(async () => {
  await destroyDb(db);
  vi.unstubAllGlobals();
});

const MONDAY = new Date("2026-09-28T09:00:00+08:00");
const b1t1: PromoDef = {
  id: "90000000-0000-7000-8000-000000000001",
  name: "Coke buy 2 get 1",
  kind: "BUY_X_GET_Y",
  value: "0",
  buy_quantity: "2",
  get_quantity: "1",
  targets: [{ type: "PRODUCT", id: IDS.coke }],
};
const promoCtx = (promotions: PromoDef[]): PromoContext => ({ promotions, timeZone: "Asia/Manila", branchId: IDS.branch });

async function method(id: string) {
  const m = await db.paymentMethods.get(id);
  if (!m) throw new Error("missing method");
  return m;
}

async function sell(cart: Cart, sessionId: string | null, amount: string) {
  return completeSale(db, {
    cart,
    tenders: [{ method: await method(IDS.cash), amount, tendered: amount }],
    cashier: { id: IDS.cashier, name: "Cathy" },
    cashSessionId: sessionId,
    priceLevelId: IDS.retail,
    pricesIncludeTax: true,
    deviceId: IDS.device,
    receiptPrefix: "MAIN-T01-",
    stockLocationId: IDS.location,
  });
}

describe("promotions in the cart", () => {
  it("applies as an AMOUNT line discount carrying promotion_id, and the totals add up", async () => {
    let cart = addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT);
    cart = setQuantity(cart, cart.lines[0].id, "3", PRICE_CONTEXT);
    cart = applyPromotions(cart, promoCtx([b1t1]), MONDAY);
    expect(cart.lines[0].promotion).toEqual({ id: b1t1.id, name: "Coke buy 2 get 1", discount: "75.00" });

    const totals = calculateCart(cart, true);
    expect(totals.ok && totals.calculation.totals.total).toBe("150.00"); // 3 × 75 − 75 free

    const sale = await sell(cart, null, "150.00");
    const item = (sale.payload as SaleCompletePayload).items[0];
    expect(item.promotion_id).toBe(b1t1.id);
    expect(item.discount).toEqual({ kind: "AMOUNT", value: "75.00", reason: "Coke buy 2 get 1", authorized_by_id: null });
    expect(item.line_discount).toBe("75.00");
  });

  it("a manual discount wins; the cashier can remove and restore a promotion", async () => {
    let cart = addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT);
    cart = setQuantity(cart, cart.lines[0].id, "3", PRICE_CONTEXT);
    const id = cart.lines[0].id;
    const manual = applyPromotions(setLineDiscount(cart, id, { kind: "PERCENT", value: "5", reason: null, authorizedById: null }), promoCtx([b1t1]), MONDAY);
    expect(manual.lines[0].promotion).toBeNull();

    const removed = applyPromotions(setPromotionsDisabled(cart, id, true), promoCtx([b1t1]), MONDAY);
    expect(removed.lines[0].promotion).toBeNull();
    const restored = applyPromotions(setPromotionsDisabled(removed, id, false), promoCtx([b1t1]), MONDAY);
    expect(restored.lines[0].promotion?.discount).toBe("75.00");
  });

  it("the store re-evaluates on every change", async () => {
    const store = useCartStore.getState();
    store.clear();
    store.setPriceContext(PRICE_CONTEXT);
    store.setPromoContext(promoCtx([{ ...b1t1, days_of_week: null }]));
    const item = await coke(db);
    for (let i = 0; i < 3; i++) useCartStore.getState().add(item);
    expect(useCartStore.getState().lines[0].promotion?.discount).toBe("75.00");
    useCartStore.getState().setQuantity(useCartStore.getState().lines[0].id, "2");
    expect(useCartStore.getState().lines[0].promotion).toBeNull();
    useCartStore.getState().clear();
  });
});

describe("customers", () => {
  it("normalizes phones like the backend", () => {
    expect(normalizePhone(" 0917 123-4567 ")).toBe("09171234567");
    expect(normalizePhone("+63 (917) 1234567")).toBe("+639171234567");
    expect(normalizePhone("  ")).toBeNull();
  });

  it("creates a customer offline with a customer.upsert outbox entry (priority 8), searchable locally", async () => {
    const customer = await createCustomerOffline(db, {
      name: "Juan Dela Cruz",
      phone: "0917 123 4567",
      priceLevelId: IDS.wholesale,
      deviceId: IDS.device,
      userId: IDS.cashier,
    });
    const [op] = await db.outbox.toArray();
    expect(op).toMatchObject({ operation: "customer.upsert", entityType: "customer", entityId: customer.id, priority: 8 });
    expect(op.payload as CustomerUpsertPayload).toEqual({
      id: customer.id,
      user_id: IDS.cashier,
      name: "Juan Dela Cruz",
      code: null,
      phone: "09171234567",
      email: null,
      price_level_id: IDS.wholesale,
      notes: null,
    });
    expect((await searchCustomers(db, "0917 123")).map((c) => c.name)).toEqual(["Juan Dela Cruz"]);
    expect((await searchCustomers(db, "dela")).map((c) => c.id)).toEqual([customer.id]);
  });

  it("selecting a customer switches the price level and the sale carries customer_id", async () => {
    await db.prices.put({ id: "pr-wh", variantId: IDS.cokeVariant, productUnitId: IDS.cokePc, priceLevelId: IDS.wholesale, branchId: null, minQuantity: "1", price: "70.00", isActive: true });
    const store = useCartStore.getState();
    store.clear();
    store.setPriceContext(PRICE_CONTEXT);
    store.setPromoContext(null);
    useCartStore.getState().add(await coke(db));
    expect(useCartStore.getState().lines[0].listPrice).toBe("75.00");
    useCartStore.getState().setCustomer({ id: "cu-1", name: "Juan", priceLevelId: IDS.wholesale });
    expect(useCartStore.getState().lines[0].listPrice).toBe("70.00");
    expect(useCartStore.getState().priceContext?.priceLevelId).toBe(IDS.wholesale);
    useCartStore.getState().clear();
    expect(useCartStore.getState().priceContext?.priceLevelId).toBe(IDS.retail);
  });
});

describe("voids", () => {
  it("voids a sale of the open shift: stock back, SALE_VOID movements, sale.void outbox (15)", async () => {
    const session = await openCashSession(db, { deviceId: IDS.device, userId: IDS.cashier, openingFloat: "100" });
    const sale = await sell(addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT), session.id, "75.00");
    expect((await db.inventory.get([IDS.location, IDS.cokeVariant]))?.quantity).toBe("9");

    await voidSale(db, { saleId: sale.sale.id, voidedById: IDS.cashier, authorizedById: IDS.manager, reason: "Wrong item", deviceId: IDS.device });
    expect((await db.sales.get(sale.sale.id))?.status).toBe("VOIDED");
    expect((await db.inventory.get([IDS.location, IDS.cokeVariant]))?.quantity).toBe("10");
    const movement = await db.inventoryMovements.get(derivedId(sale.items[0].id, "SALE_VOID"));
    expect(movement).toMatchObject({ movementType: "SALE_VOID", signedQuantity: "1", referenceId: sale.sale.id });
    const op = (await db.outbox.toArray()).at(-1);
    expect(op).toMatchObject({ operation: "sale.void", entityType: "sale", entityId: sale.sale.id, priority: 15 });
    expect(op?.payload as SaleVoidPayload).toMatchObject({ id: sale.sale.id, voided_by_id: IDS.cashier, authorized_by_id: IDS.manager, reason: "Wrong item" });

    await expect(voidSale(db, { saleId: sale.sale.id, voidedById: IDS.cashier, authorizedById: null, reason: "again", deviceId: IDS.device })).rejects.toThrow(ReturnVoidError);
    // Voided sales are not expected in the drawer.
    expect((await summarizeSession(db, session.id)).expectedCash).toBe("100.00");
  });

  it("refuses voids after the shift closed", async () => {
    const session = await openCashSession(db, { deviceId: IDS.device, userId: IDS.cashier, openingFloat: "0" });
    const sale = await sell(addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT), session.id, "75.00");
    await closeCashSession(db, { deviceId: IDS.device, sessionId: session.id, userId: IDS.cashier, countedCash: "75", note: null });
    await expect(voidSale(db, { saleId: sale.sale.id, voidedById: IDS.cashier, authorizedById: null, reason: "late", deviceId: IDS.device })).rejects.toThrow(/closed/);
  });
});

describe("returns", () => {
  async function threeCokesAt3333() {
    await db.prices.update("pr000000-0000-7000-8000-000000000001", { price: "33.33" });
    const cart = addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT);
    return setQuantity(cart, cart.lines[0].id, "3", PRICE_CONTEXT);
  }

  it("refunds pro-rata, the last units exactly the remainder, and refuses over-returns", async () => {
    const session = await openCashSession(db, { deviceId: IDS.device, userId: IDS.cashier, openingFloat: "500" });
    const sale = await sell(await threeCokesAt3333(), session.id, "99.99");
    const saleItemId = sale.items[0].id;
    const base = { saleId: sale.sale.id, cashier: { id: IDS.cashier, name: "Cathy" }, authorizedById: IDS.manager, reason: "Changed mind", cashSessionId: session.id, deviceId: IDS.device, receiptPrefix: "MAIN-T01-" };
    const cash = await method(IDS.cash);

    const first = await createReturn(db, { ...base, lines: [{ saleItemId, quantity: "1", restock: true }], refunds: [{ method: cash, amount: "33.33" }] });
    expect(first.ret).toMatchObject({ returnNumber: "MAIN-T01-R000001", refundTotal: "33.33" });
    expect(await getMeta(db, "returnSeq")).toBe(1);
    expect((await db.inventory.get([IDS.location, IDS.cokeVariant]))?.quantity).toBe("8"); // 10 − 3 + 1
    expect(await db.inventoryMovements.get(derivedId(first.items[0].id, "SALE_RETURN"))).toMatchObject({ signedQuantity: "1", referenceId: first.ret.id });
    const op = (await db.outbox.toArray()).at(-1);
    expect(op).toMatchObject({ operation: "return.create", entityType: "return", entityId: first.ret.id, priority: 50 });
    expect(op?.payload as ReturnCreatePayload).toMatchObject({
      sale_id: sale.sale.id,
      return_number: "MAIN-T01-R000001",
      items: [{ sale_item_id: saleItemId, quantity: "1", restock: true }],
      refunds: [{ payment_method_id: IDS.cash, amount: "33.33" }],
    });

    // Remaining two units refund exactly 99.99 − 33.33 = 66.66 (not 2 × 33.33 rounded differently).
    const lines = await returnableLines(db, sale.sale.id);
    expect(computeRefunds(lines, [{ saleItemId, quantity: "2", restock: false }])).toEqual(["66.66"]);
    await expect(
      createReturn(db, { ...base, lines: [{ saleItemId, quantity: "2", restock: false }], refunds: [{ method: cash, amount: "66.67" }] }),
    ).rejects.toThrow(/must equal/);
    await createReturn(db, { ...base, lines: [{ saleItemId, quantity: "2", restock: false }], refunds: [{ method: cash, amount: "66.66" }] });
    expect((await db.inventory.get([IDS.location, IDS.cokeVariant]))?.quantity).toBe("8"); // not restocked
    await expect(
      createReturn(db, { ...base, lines: [{ saleItemId, quantity: "1", restock: true }], refunds: [{ method: cash, amount: "33.33" }] }),
    ).rejects.toThrow(/can still be returned/);

    // A sale with returns can't be voided; cash refunds leave the drawer.
    await expect(voidSale(db, { saleId: sale.sale.id, voidedById: IDS.cashier, authorizedById: null, reason: "nope", deviceId: IDS.device })).rejects.toThrow(/returned/);
    const summary = await summarizeSession(db, session.id);
    expect(summary).toMatchObject({ cashRefunds: "99.99", returnCount: 2, expectedCash: "500.00" }); // 500 + 99.99 − 99.99
  });

  it("is atomic: a failure mid-way leaves nothing behind", async () => {
    const sale = await sell(addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT), null, "75.00");
    vi.spyOn(db.outbox, "add").mockRejectedValueOnce(new Error("disk full"));
    await expect(
      createReturn(db, {
        saleId: sale.sale.id,
        lines: [{ saleItemId: sale.items[0].id, quantity: "1", restock: true }],
        refunds: [{ method: await method(IDS.cash), amount: "75.00" }],
        cashier: { id: IDS.cashier, name: "Cathy" },
        authorizedById: null,
        reason: "Broken",
        cashSessionId: null,
        deviceId: IDS.device,
        receiptPrefix: "MAIN-T01-",
      }),
    ).rejects.toThrow("disk full");
    expect(await db.returns.count()).toBe(0);
    expect(await db.returnItems.count()).toBe(0);
    expect(await db.inventoryMovements.filter((m) => m.movementType === "SALE_RETURN").count()).toBe(0);
    expect((await db.inventory.get([IDS.location, IDS.cokeVariant]))?.quantity).toBe("9");
    expect(await getMeta(db, "returnSeq")).toBeUndefined();
  });
});

describe("stock warning and settings", () => {
  it("warns when the cart holds more than local stock (in base units)", async () => {
    let cart = addItem(EMPTY_CART, await coke(db, "box"), PRICE_CONTEXT); // 12 PC vs 10 on hand
    expect(await checkStock(db, cart, IDS.cokeVariant, IDS.location)).toMatchObject({ inCart: "12", onHand: "10" });
    cart = addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT);
    expect(await checkStock(db, cart, IDS.cokeVariant, IDS.location)).toBeNull();
  });

  it("persists terminal settings in IndexedDB with defaults for new fields", async () => {
    expect(await getTerminalSettings(db)).toEqual(DEFAULT_SETTINGS);
    await saveTerminalSettings(db, { receiptWidth: 58, scannerMaxInterKeyMs: 120, printReceiptAutomatically: false });
    expect(await getTerminalSettings(db)).toEqual({ ...DEFAULT_SETTINGS, receiptWidth: 58, scannerMaxInterKeyMs: 120, printReceiptAutomatically: false });
  });
});
