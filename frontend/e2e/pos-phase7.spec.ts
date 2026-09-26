/**
 * Phase 7 offline flow: a promotion applies, a customer is created offline and attached to a
 * sale, one sale is voided and one item returned (with manager approval, verified locally) —
 * then everything syncs and the server agrees, with no rejected operations.
 */
import { expect, test, type Page } from "@playwright/test";

import { balances, salesForDevice, seedCompany } from "./support/api";
import { createManager, createPromotion, customers, failedOperations, MANAGER_PIN, returnsToday, saleByReceipt } from "./support/phase7";
import { bringApiBack, localCounts, openCashSession, pay, pinLogin, scan, setupTerminal, takeApiOffline, waitUntilSynced } from "./support/pos";

async function approveAsManager(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Mara Manager" }).click();
  await page.getByLabel("Manager PIN").fill(MANAGER_PIN);
  await page.getByLabel("Manager PIN").press("Enter");
}

test("offline promotion, customer, void and return sync correctly", async ({ page }) => {
  test.setTimeout(300_000);
  const company = await seedCompany({
    products: [
      { name: "Cola Can", price: "25.00", stock: "50" },
      { name: "Chips Pack", price: "30.00", stock: "50" },
    ],
  });
  const [cola, chips] = company.products;
  await createManager(company);
  const promo = await createPromotion(company, {
    name: "Cola buy 2 get 1",
    kind: "BUY_X_GET_Y",
    buy_quantity: "2",
    get_quantity: "1",
    targets: [{ type: "VARIANT", id: cola.variantId }],
  });

  await setupTerminal(page, company, "T01");
  await pinLogin(page, company.cashier.fullName);
  await openCashSession(page, "1000.00");
  const { deviceId } = await localCounts(page);
  await takeApiOffline(page);

  // Sale 1: new customer created offline + 3 colas with buy-2-get-1 → 50.00
  await page.getByRole("button", { name: "Customer", exact: true }).click();
  await page.getByRole("button", { name: "New customer" }).click();
  await page.getByLabel("Name").fill("Juan Dela Cruz");
  await page.getByLabel("Phone (optional)").fill("0917 555 0101");
  await page.getByRole("button", { name: "Save customer" }).click();
  await expect(page.getByTestId("cart-customer")).toHaveText("Juan Dela Cruz");
  await page.getByLabel("Scan or search").focus();
  for (let i = 0; i < 3; i++) await scan(page, cola.barcode);
  await expect(page.getByTestId("promo-badge")).toContainText("Cola buy 2 get 1");
  await expect(page.getByTestId("cart-total")).toHaveText(/50\.00/);
  await pay(page, [{ method: "Cash", amount: "100" }]);
  await expect(page.getByTestId("cart-customer")).toHaveText("Walk-in customer");

  // Sale 2 (to be voided) and sale 3 (one item returned)
  await scan(page, chips.barcode);
  await pay(page, [{ method: "Cash", amount: "30" }]);
  await scan(page, chips.barcode);
  await scan(page, chips.barcode);
  await pay(page, [{ method: "Cash", amount: "60" }]);

  await page.getByRole("button", { name: "Sales" }).click();
  await page.getByRole("button", { name: "Void MAIN-T01-000002" }).click();
  await page.getByLabel("Reason").fill("Rang up by mistake");
  await page.getByRole("button", { name: "Void sale" }).click();
  await approveAsManager(page);
  await expect(page.getByTestId("sale-row").filter({ hasText: "MAIN-T01-000002" })).toContainText("VOIDED");

  await page.getByRole("button", { name: "Return items of MAIN-T01-000003" }).click();
  await page.getByLabel("Return quantity Chips Pack").fill("1");
  await page.getByLabel("Reason").fill("Torn bag");
  await page.getByRole("button", { name: /^Refund/ }).click();
  await approveAsManager(page);
  await expect(page.getByTestId("sale-row").filter({ hasText: "MAIN-T01-000003" })).toContainText("RETURNS");

  // Back online
  await bringApiBack(page);
  await waitUntilSynced(page);

  expect((await salesForDevice(company.token, deviceId)).total).toBe(3);
  const [juan] = await customers(company, "Juan");
  expect(juan).toMatchObject({ name: "Juan Dela Cruz", phone: "09175550101" });
  const sale1 = await saleByReceipt(company, "MAIN-T01-000001");
  expect(sale1).toMatchObject({ customer_id: juan.id, total: "50.00", discount_total: "25.00" });
  expect(sale1.items[0].line_discount).toBe("25.00");
  expect((await saleByReceipt(company, "MAIN-T01-000002")).status).toBe("VOIDED");
  const returns = await returnsToday(company);
  expect(returns).toHaveLength(1);
  expect(returns[0]).toMatchObject({ return_number: "MAIN-T01-R000001", refund_total: "30.00" });
  expect(await failedOperations(company)).toEqual([]);

  // Stock: cola 50 − 3; chips 50 − 1 − 2 + 1 (void) + 1 (restocked return)
  const server = (await balances(company.token)).items;
  expect(Number(server.find((b) => b.variant_id === cola.variantId)?.quantity)).toBe(47);
  expect(Number(server.find((b) => b.variant_id === chips.variantId)?.quantity)).toBe(49);
  expect(promo.id).toBeTruthy();
});
