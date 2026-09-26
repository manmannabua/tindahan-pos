/**
 * The critical scenario (docs/TESTING.md §3): initialize online, lose the API, sell 20 times from
 * IndexedDB, restart, reconnect, and verify PostgreSQL has exactly those 20 sales — once.
 *
 * Requires the backend (E2E_API_URL) and the web app (E2E_BASE_URL or `pnpm dev`).
 */
import { expect, test } from "@playwright/test";

import { balances, reviewFlags, saleDetail, salesForDevice, seedCompany } from "./support/api";
import {
  bringApiBack,
  localCounts,
  openCashSession,
  pay,
  pinLogin,
  scan,
  setupTerminal,
  takeApiOffline,
  waitUntilSynced,
  type Tender,
} from "./support/pos";

test.describe.configure({ mode: "serial" });

test("20 offline sales survive a restart and sync exactly once", async ({ page }) => {
  test.setTimeout(300_000);
  const company = await seedCompany({
    products: [
      { name: "Coke 1.5L", price: "75.00", stock: "100" },
      { name: "Sardines 155g", price: "25.50", stock: "100" },
      { name: "Rice 1kg", price: "58.00", stock: "100" },
    ],
  });
  const [coke, sardines, rice] = company.products;

  await setupTerminal(page, company, "T01");
  await pinLogin(page, company.cashier.fullName);
  await openCashSession(page, "1000.00");
  const { deviceId } = await localCounts(page);
  expect(deviceId).toBeTruthy();

  // --- FastAPI disappears ---------------------------------------------------------------
  await takeApiOffline(page);

  const expectedQty = new Map<string, number>(company.products.map((p) => [p.variantId, 0]));
  for (let i = 0; i < 20; i++) {
    const basket = [coke, i % 2 === 0 ? sardines : rice, ...(i % 5 === 0 ? [rice] : [])];
    for (const product of basket) {
      await scan(page, product.barcode);
      expectedQty.set(product.variantId, (expectedQty.get(product.variantId) ?? 0) + 1);
    }
    await expect(page.getByTestId("cart-line").first()).toBeVisible();
    const tenders: Tender[] =
      i === 7
        ? [{ method: "GCash", amount: "50.00", reference: `GC-SPLIT-${i}` }, { method: "Cash", amount: "500" }]
        : i % 3 === 0
          ? [{ method: "GCash", reference: `GC-${i}` }]
          : [{ method: "Cash", amount: "500" }];
    await pay(page, tenders);
  }
  await expect(page.getByRole("status")).toContainText("OFFLINE");

  let local = await localCounts(page);
  expect(local.sales).toBe(20);
  // cash_session.open (may have synced before the API went down) + 20 × sale.complete
  expect(local.outboxPending + local.outboxSynced).toBe(21);
  expect(local.outboxPending).toBeGreaterThanOrEqual(20);

  // --- Restart the app (API still down) --------------------------------------------------
  await page.reload();
  await pinLogin(page, company.cashier.fullName);
  await page.getByRole("button", { name: "Sales" }).click();
  await expect(page.getByTestId("sale-row")).toHaveCount(20);
  local = await localCounts(page);
  expect(local.sales).toBe(20);
  expect(local.outboxPending + local.outboxSynced).toBe(21);

  // --- FastAPI is back ------------------------------------------------------------------------
  await bringApiBack(page);
  await waitUntilSynced(page);
  await expect(page.getByRole("status")).toContainText("ONLINE", { timeout: 30_000 });

  const synced = await salesForDevice(company.token, deviceId);
  expect(synced.total).toBe(20);
  const receipts = synced.items.map((s) => s.receipt_number);
  expect(new Set(receipts).size).toBe(20);
  expect(receipts.sort()[0]).toBe("MAIN-T01-000001");
  expect(receipts.sort()[19]).toBe("MAIN-T01-000020");

  // Payments match the totals; the split sale has two payments.
  let splitSales = 0;
  for (const sale of synced.items) {
    const detail = await saleDetail(company.token, sale.id);
    const paid = detail.payments.reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
    expect(paid).toBe(Math.round(Number(sale.total) * 100));
    if (detail.payments.length === 2) splitSales += 1;
  }
  expect(splitSales).toBe(1);

  // Inventory movements reached the ledger.
  const server = await balances(company.token);
  for (const product of company.products) {
    const row = server.items.find((b) => b.variant_id === product.variantId);
    expect(Number(row?.quantity)).toBe(100 - (expectedQty.get(product.variantId) ?? 0));
  }
  expect((await reviewFlags(company.token)).items.filter((f) => f.flag_type !== "USER_NOT_AUTHORIZED")).toEqual([]);

  // A second forced sync creates nothing new.
  await page.getByRole("button", { name: "Sync" }).click();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText("Everything is synced.")).toBeVisible();
  expect((await salesForDevice(company.token, deviceId)).total).toBe(20);
  expect((await localCounts(page)).outboxSynced).toBe(21);
});

test("two offline terminals oversell the same stock: both sales kept, negative stock flagged", async ({ browser }) => {
  test.setTimeout(300_000);
  const company = await seedCompany({ products: [{ name: "Last Units Item", price: "10.00", stock: "5" }] });
  const [item] = company.products;

  const terminals = await Promise.all([browser.newContext(), browser.newContext()]);
  const pages = await Promise.all(terminals.map((c) => c.newPage()));
  for (const [i, page] of pages.entries()) {
    await setupTerminal(page, company, `T0${i + 1}`);
    await pinLogin(page, company.cashier.fullName);
    await openCashSession(page, "100.00");
    await takeApiOffline(page);
  }

  // Terminal A sells 4, terminal B sells 3 — both believe 5 are in stock.
  for (const [page, quantity] of [
    [pages[0], 4],
    [pages[1], 3],
  ] as const) {
    for (let n = 0; n < quantity; n++) await scan(page, item.barcode);
    await expect(page.getByTestId("cart-qty")).toHaveText(String(quantity));
    await pay(page, [{ method: "Cash", amount: "100" }]);
  }

  for (const page of pages) {
    await bringApiBack(page);
    await waitUntilSynced(page);
  }

  const row = (await balances(company.token)).items.find((b) => b.variant_id === item.variantId);
  expect(Number(row?.quantity)).toBe(-2);
  const flags = (await reviewFlags(company.token)).items.filter((f) => f.flag_type === "NEGATIVE_INVENTORY");
  expect(flags).toHaveLength(1);
  expect(flags[0].entity_id).toBe(item.variantId);

  await Promise.all(terminals.map((c) => c.close()));
});
