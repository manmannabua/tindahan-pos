/**
 * Feature switches reach the terminal: switched-off features disappear from the POS (no cash
 * session needed without cash management), and switching one back on shows up after a sync.
 */
import { expect, test } from "@playwright/test";

import { API_URL, seedCompany } from "./support/api";
import { pay, pinLogin, scan, setupTerminal } from "./support/pos";

async function setFeatures(token: string, features: Record<string, boolean>): Promise<void> {
  const response = await fetch(`${API_URL}/companies/current/features`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Requested-With": "pos", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ features }),
  });
  if (!response.ok) throw new Error(`features → ${response.status}: ${await response.text()}`);
}

test("switched-off features are hidden on the terminal and come back after a sync", async ({ page }) => {
  test.setTimeout(150_000);
  const company = await seedCompany({ products: [{ name: "Pandesal (10 pcs)", price: "30.00", stock: "50" }] });
  await setFeatures(company.token, {
    customers: false,
    discounts: false,
    sc_pwd: false,
    bir: false,
    cash_management: false,
    receipt_journal: false,
    returns: false,
  });

  await setupTerminal(page, company, "T01");
  await pinLogin(page, company.cashier.fullName);

  // No cash session: selling starts right away.
  const nav = page.getByRole("navigation", { name: "Terminal" });
  await expect(page.getByLabel("Scan or search")).toBeVisible();
  for (const tab of ["Cash", "Receipts", "Readings"]) await expect(nav.getByRole("button", { name: tab })).toHaveCount(0);
  for (const button of ["Customer", "Discount", "Senior / PWD"]) {
    await expect(page.getByRole("button", { name: button, exact: true })).toHaveCount(0);
  }

  await scan(page, company.products[0].barcode);
  await pay(page, [{ method: "Cash", amount: "50" }]);
  await nav.getByRole("button", { name: "Sales" }).click();
  await expect(page.getByTestId("sale-row")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Return items of/ })).toHaveCount(0);

  // The owner switches discounts and the receipt journal back on; the terminal syncs.
  await setFeatures(company.token, { discounts: true, receipt_journal: true });
  await nav.getByRole("button", { name: "Sync" }).click();
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(nav.getByRole("button", { name: "Receipts" })).toBeVisible({ timeout: 30_000 });
  await nav.getByRole("button", { name: "Sell" }).click();
  await expect(page.getByRole("button", { name: "Discount", exact: true })).toBeVisible();
});
