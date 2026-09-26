import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PosDatabase } from "@/lib/db/schema";
import { useCartStore } from "@/stores/cart-store";
import { coke, createTerminalDb, destroyDb, IDS, PRICE_CONTEXT } from "@/test-utils/terminal-fixture";

import { addItem, calculateCart, EMPTY_CART, overridePrice, removeLine, setLineDiscount, setQuantity } from "./cart";

let db: PosDatabase;
beforeEach(async () => {
  db = await createTerminalDb();
});
afterEach(async () => {
  await destroyDb(db);
});

describe("cart", () => {
  it("increments identical lines and resolves quantity-break prices", async () => {
    const item = await coke(db);
    item.prices.push({ ...item.prices[0], id: "break", minQuantity: "6.000", price: "70.00" });
    let cart = addItem(EMPTY_CART, item, PRICE_CONTEXT);
    expect(cart.lines[0].listPrice).toBe("75.00");
    cart = setQuantity(cart, cart.lines[0].id, "6", PRICE_CONTEXT);
    expect(cart.lines[0].listPrice).toBe("70.00");
    cart = addItem(cart, item, PRICE_CONTEXT);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe("7");
  });

  it("keeps discounted or re-priced lines separate", async () => {
    const item = await coke(db);
    let cart = addItem(EMPTY_CART, item, PRICE_CONTEXT);
    cart = setLineDiscount(cart, cart.lines[0].id, { kind: "AMOUNT", value: "5", reason: null, authorizedById: null });
    cart = addItem(cart, item, PRICE_CONTEXT);
    expect(cart.lines).toHaveLength(2);
    cart = overridePrice(cart, cart.lines[1].id, { price: "60.00", authorizedById: IDS.manager });
    const totals = calculateCart(cart, true);
    expect(totals.ok && totals.calculation.totals.total).toBe("130.00");
  });

  it("removes a line when quantity drops to zero", async () => {
    let cart = addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT);
    cart = setQuantity(cart, cart.lines[0].id, "0", PRICE_CONTEXT);
    expect(cart.lines).toHaveLength(0);
    expect(removeLine(cart, "missing").lines).toHaveLength(0);
  });

  it("reports missing prices instead of guessing", async () => {
    const item = { ...(await coke(db)), prices: [] };
    const totals = calculateCart(addItem(EMPTY_CART, item, PRICE_CONTEXT), true);
    expect(totals).toMatchObject({ ok: false, error: "No price for Coke 1.5L" });
  });

  it("zustand store wraps the pure functions", async () => {
    const store = useCartStore.getState();
    store.clear();
    store.setPriceContext(PRICE_CONTEXT);
    store.add(await coke(db));
    store.add(await coke(db));
    expect(useCartStore.getState().lines[0].quantity).toBe("2");
    expect(useCartStore.getState().activeLineId).toBe(useCartStore.getState().lines[0].id);
    useCartStore.getState().clear();
    expect(useCartStore.getState().lines).toHaveLength(0);
  });
});
