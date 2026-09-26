/**
 * Receipt journal end to end: a sale rung up while the API is down is in the terminal's
 * Receipts screen at once (virtual receipt), reprints are counted, and once back online the
 * journal — receipt and every print — reaches the server.
 */
import { expect, test } from "@playwright/test";

import { API_URL, seedCompany } from "./support/api";
import { bringApiBack, openCashSession, pay, pinLogin, scan, setupTerminal, takeApiOffline, waitUntilSynced } from "./support/pos";

interface JournalRow {
  number: string;
  print_count: number;
  last_print_method: string | null;
}

test("offline receipt journal, reprint, then synced to the server", async ({ page }) => {
  test.setTimeout(180_000);
  const company = await seedCompany({ products: [{ name: "Kape Barako 250g", price: "185.00", stock: "10" }] });
  const [kape] = company.products;

  await setupTerminal(page, company, "T01");
  await pinLogin(page, company.cashier.fullName);
  await openCashSession(page);
  await takeApiOffline(page);

  await scan(page, kape.barcode);
  await pay(page, [{ method: "Cash", amount: "200" }]); // printed automatically (browser)

  await page.getByRole("button", { name: "Receipts" }).click();
  const row = page.getByRole("list", { name: "Receipts" }).getByRole("button").first();
  await expect(row).toContainText("MAIN-T01-000001");
  await expect(row).toContainText("Not synced");
  await expect(row).toContainText(/Browser print/);

  // The virtual receipt is the stored copy.
  const receipt = page.getByRole("figure", { name: "Receipt MAIN-T01-000001" });
  await expect(receipt).toContainText("Kape Barako 250g");
  await expect(receipt).toContainText("185.00");

  await page.getByRole("complementary").getByRole("button", { name: "Reprint" }).click();
  await expect(row).toContainText("Browser print ×2");

  await bringApiBack(page);
  await waitUntilSynced(page);
  await expect(row).not.toContainText("Not synced");

  const response = await fetch(`${API_URL}/receipts?q=MAIN-T01-000001`, {
    headers: { Authorization: `Bearer ${company.token}`, "X-Requested-With": "pos" },
  });
  const journal = (await response.json()) as { items: JournalRow[] };
  expect(journal.items.map((r) => [r.number, r.print_count, r.last_print_method])).toEqual([["MAIN-T01-000001", 2, "BROWSER"]]);
});
