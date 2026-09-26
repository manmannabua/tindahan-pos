/**
 * Senior citizen / PWD sales on the terminal: cart, completeSale payload and the receipt.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadPosContext } from "@/lib/db/context";
import { setMeta } from "@/lib/db/meta";
import type { LocalStatutory, PosDatabase } from "@/lib/db/schema";
import { COLUMNS, layoutReceipt } from "@/lib/printing/receipt";
import { coke, createTerminalDb, destroyDb, IDS, PRICE_CONTEXT } from "@/test-utils/terminal-fixture";
import type { SaleCompletePayload } from "@/types/sync";

import { addItem, calculateCart, EMPTY_CART, lineDiscountFor, setLineDiscount, setStatutory, type Cart } from "./cart";
import { completeSale, SaleValidationError } from "./complete-sale";
import { loadReceipt } from "./receipts";

let db: PosDatabase;
beforeEach(async () => {
  db = await createTerminalDb();
});
afterEach(async () => {
  await destroyDb(db);
});

const SENIOR: LocalStatutory = { kind: "SENIOR", idNumber: "OSCA-123", holderName: "Lola Basyang", holderTin: null };

/** One eligible Coke (₱75 VAT-inclusive) and one regular Coke box (₱850). */
async function mixedCart(statutory: LocalStatutory | null): Promise<Cart> {
  let cart = addItem(EMPTY_CART, { ...(await coke(db)), scPwdEligible: true }, PRICE_CONTEXT);
  cart = addItem(cart, await coke(db, "box"), PRICE_CONTEXT);
  return setStatutory(cart, statutory);
}

async function sell(cart: Cart, amount: string) {
  const cash = await db.paymentMethods.get(IDS.cash);
  if (!cash) throw new Error("missing");
  return completeSale(db, {
    cart,
    tenders: [{ method: cash, amount, tendered: amount }],
    cashier: { id: IDS.cashier, name: "Cathy" },
    cashSessionId: null,
    priceLevelId: IDS.retail,
    pricesIncludeTax: true,
    deviceId: IDS.device,
    receiptPrefix: "MAIN-T01-",
    stockLocationId: IDS.location,
  });
}

describe("SC/PWD cart", () => {
  it("removes VAT and takes 20% off eligible lines only", async () => {
    const result = calculateCart(await mixedCart(SENIOR), true);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [sc, regular] = result.calculation.lines;
    // 75 / 1.12 = 66.96 base, 8.04 VAT exemption, 20% of 66.96 = 13.39, pays 53.57, no VAT.
    expect(sc).toMatchObject({ vatExemption: "8.04", statutoryDiscount: "13.39", total: "53.57", taxAmount: "0.00" });
    expect(regular).toMatchObject({ vatExemption: "0.00", statutoryDiscount: "0.00", total: "850.00" });
    expect(result.calculation.totals).toMatchObject({
      total: "903.57",
      vatExemptionTotal: "8.04",
      statutoryDiscountTotal: "13.39",
    });
  });

  it("without a holder the same cart is a regular sale", async () => {
    const result = calculateCart(await mixedCart(null), true);
    expect(result.ok && result.calculation.totals.total).toBe("925.00");
  });

  it("never stacks a manual discount on a statutory line", async () => {
    let cart = await mixedCart(SENIOR);
    cart = setLineDiscount(cart, cart.lines[0].id, { kind: "PERCENT", value: "10", reason: "x", authorizedById: null });
    expect(lineDiscountFor(cart, cart.lines[0])).toBeNull();
    const result = calculateCart(cart, true);
    expect(result.ok && result.calculation.lines[0].total).toBe("53.57");
  });
});

describe("SC/PWD sale", () => {
  it("sends statutory fields and holder details in the sync payload", async () => {
    const { sale, payload } = await sell(await mixedCart(SENIOR), "903.57");
    expect(sale.statutory).toEqual(SENIOR);
    const p = payload as SaleCompletePayload;
    expect(p.statutory_discount).toEqual({ kind: "SENIOR", id_number: "OSCA-123", holder_name: "Lola Basyang", holder_tin: null });
    expect(p.items[0]).toMatchObject({ statutory: true, vat_exemption: "8.04", statutory_discount: "13.39", discount: null, total: "53.57" });
    expect(p.items[1]).toMatchObject({ statutory: false, vat_exemption: "0.00", statutory_discount: "0.00" });
    expect(p.totals).toMatchObject({ total: "903.57", vat_exemption_total: "8.04", statutory_discount_total: "13.39" });
  });

  it("refuses a statutory sale without the holder's ID and name", async () => {
    const cart = await mixedCart({ ...SENIOR, idNumber: "  " });
    await expect(sell(cart, "903.57")).rejects.toBeInstanceOf(SaleValidationError);
    expect(await db.sales.count()).toBe(0);
  });

  it.each([58, 80] as const)("prints the BIR header, SC/PWD lines and signature block at %i mm", async (width) => {
    await setMeta(db, "deviceBir", { min: "MIN-777", serialNumber: "SN-42", ptuNumber: "PTU-9", ptuIssuedOn: "2026-01-15" });
    const { sale } = await sell(await mixedCart(SENIOR), "903.57");
    const context = await loadPosContext(db);
    const company = { ...context.company, legalName: "Acme Mart Corp.", vatRegistered: true, birAccreditationNo: "ACC-0001" };
    const doc = await loadReceipt(db, sale.id, { ...context, company, settings: { ...context.settings, receiptWidth: width } }, false);
    if (!doc) throw new Error("no receipt");
    const rows = layoutReceipt(doc);
    for (const row of rows) expect(row.text.length).toBeLessThanOrEqual(COLUMNS[width]);
    const text = rows.map((r) => r.text).join("\n");
    expect(text).toContain("Acme Mart Corp.");
    expect(text).toContain("VAT REG TIN: 123-456");
    expect(text).toContain("MIN: MIN-777");
    expect(text).toContain("SN: SN-42");
    expect(text).toContain("PTU No.: PTU-9 (2026-01-15)");
    expect(text).toContain("Accr. No.: ACC-0001");
    expect(text).toContain("(SC/PWD)");
    expect(text).toMatch(/Less: VAT exemption\s+-8\.04/);
    expect(text).toMatch(/Less: 20% SC\/PWD discount\s+-13\.39/);
    expect(text).not.toMatch(/^Discount\s/m);
    expect(text).toContain("SENIOR CITIZEN DISCOUNT");
    expect(text).toMatch(/Name\s+Lola Basyang/);
    expect(text).toMatch(/OSCA\/SC ID\s+OSCA-123/);
    expect(text).toMatch(/Signature:\s+_{20}/);
  });

  it("prints NON-VAT REG TIN for a non-VAT company", async () => {
    const { sale } = await sell(addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT), "75.00");
    const context = await loadPosContext(db);
    const doc = await loadReceipt(db, sale.id, { ...context, company: { ...context.company, vatRegistered: false } }, false);
    const text = layoutReceipt(doc!).map((r) => r.text).join("\n");
    expect(text).toContain("NON-VAT REG TIN: 123-456");
  });
});
