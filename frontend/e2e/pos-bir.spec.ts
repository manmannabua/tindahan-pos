/**
 * BIR features end to end: a senior citizen sale rung up offline syncs with its statutory
 * discount intact, and another terminal returns an item of it via the online receipt lookup.
 */
import { expect, test, type Page } from "@playwright/test";

import { balances, reviewFlags, seedCompany } from "./support/api";
import { createManager, failedOperations, MANAGER_PIN, returnsToday, saleByReceipt } from "./support/phase7";
import { bringApiBack, localCounts, openCashSession, pay, pinLogin, scan, setupTerminal, takeApiOffline, waitUntilSynced } from "./support/pos";

test.describe.configure({ mode: "serial" });

async function approveAsManager(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Mara Manager" }).click();
  await page.getByLabel("Manager PIN").fill(MANAGER_PIN);
  await page.getByLabel("Manager PIN").press("Enter");
}

interface StatutorySale {
  id: string;
  total: string;
  statutory_kind: string | null;
  statutory_id_number: string | null;
  statutory_holder_name: string | null;
  vat_exemption_total: string;
  statutory_discount_total: string;
  items: { product_name: string; statutory: boolean; vat_exemption: string; statutory_discount: string; total: string }[];
}

test("offline senior citizen sale syncs; another terminal returns an item via online lookup", async ({ browser }) => {
  test.setTimeout(300_000);
  const company = await seedCompany({
    products: [
      { name: "Maintenance Meds", price: "100.00", stock: "20", scPwdEligible: true },
      { name: "Soft Drink", price: "50.00", stock: "20" },
    ],
  });
  const [meds, drink] = company.products;
  await createManager(company);

  const [ctxA, ctxB] = await Promise.all([browser.newContext(), browser.newContext()]);
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();

  // --- Terminal T01: SC sale while the API is down -------------------------------------------
  await setupTerminal(a, company, "T01");
  await pinLogin(a, company.cashier.fullName);
  await openCashSession(a, "1000.00");
  const { deviceId } = await localCounts(a);
  await takeApiOffline(a);

  await scan(a, meds.barcode);
  await scan(a, drink.barcode);
  await a.getByRole("button", { name: "Senior / PWD" }).click();
  await a.getByLabel("OSCA / Senior citizen ID no.").fill("OSCA-000123");
  await a.getByLabel("Name of holder").fill("Lola Basyang");
  await a.getByRole("button", { name: "Apply" }).click();
  // Meds: 100 / 1.12 = 89.29, less 20% (17.86) = 71.43; the drink stays 50.00.
  await expect(a.getByTestId("cart-total")).toHaveText(/121\.43/);
  await pay(a, [{ method: "Cash", amount: "200" }]);

  await bringApiBack(a);
  await waitUntilSynced(a);

  const sale = (await saleByReceipt(company, "MAIN-T01-000001")) as unknown as StatutorySale;
  expect(sale).toMatchObject({
    total: "121.43",
    statutory_kind: "SENIOR",
    statutory_id_number: "OSCA-000123",
    statutory_holder_name: "Lola Basyang",
    vat_exemption_total: "10.71",
    statutory_discount_total: "17.86",
  });
  const medsLine = sale.items.find((i) => i.product_name === "Maintenance Meds");
  expect(medsLine).toMatchObject({ statutory: true, vat_exemption: "10.71", statutory_discount: "17.86", total: "71.43" });
  expect(sale.items.find((i) => i.product_name === "Soft Drink")).toMatchObject({ statutory: false, total: "50.00" });
  expect((await reviewFlags(company.token)).items.filter((f) => f.flag_type !== "USER_NOT_AUTHORIZED")).toEqual([]);
  expect(deviceId).toBeTruthy();

  // --- Terminal T02 (online): return the drink from T01's receipt -----------------------------
  await setupTerminal(b, company, "T02");
  await pinLogin(b, company.cashier.fullName);
  await openCashSession(b, "500.00");
  await b.getByRole("button", { name: "Sales" }).click();
  await b.getByLabel("Receipt number to return").fill("MAIN-T01-000001");
  await b.getByRole("button", { name: "Find" }).click();
  const dialog = b.getByRole("dialog");
  await expect(dialog).toContainText("made on another terminal");
  await dialog.getByLabel("Return quantity Soft Drink").fill("1");
  await dialog.getByLabel("Reason").fill("Wrong flavor");
  await dialog.getByRole("button", { name: /^Refund/ }).click();
  await approveAsManager(b);
  await expect(b.getByText(/Return MAIN-T02-R000001/)).toBeVisible();
  await waitUntilSynced(b);

  const returns = await returnsToday(company);
  expect(returns).toHaveLength(1);
  expect(returns[0]).toMatchObject({ return_number: "MAIN-T02-R000001", refund_total: "50.00", original_sale_id: sale.id });
  expect(await failedOperations(company)).toEqual([]);
  const server = (await balances(company.token)).items;
  expect(Number(server.find((r) => r.variant_id === drink.variantId)?.quantity)).toBe(20); // sold 1, returned 1
  expect(Number(server.find((r) => r.variant_id === meds.variantId)?.quantity)).toBe(19);

  await Promise.all([ctxA.close(), ctxB.close()]);
});
