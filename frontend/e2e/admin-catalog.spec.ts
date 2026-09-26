import { expect, type Page, test } from "@playwright/test";

import { API_URL, PASSWORD } from "./support/api";

/**
 * Admin back-office flow (requires the backend, started with RATE_LIMIT_ENABLED=false):
 * category + product with barcode & price → search → purchase order → receive → stock →
 * sales-summary report → CSV export.
 */

async function api<T>(path: string, body?: unknown, token?: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "pos", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} → ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

async function choose(page: Page, label: string | RegExp, option: string | RegExp, scope = page.locator("body")) {
  await scope.getByLabel(label).first().click();
  await page.getByRole("option", { name: option }).first().click();
}

test("catalog → purchasing → stock → report export", async ({ page }) => {
  test.setTimeout(120_000);
  const code = `ADM${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const email = `owner-${code.toLowerCase()}@example.com`;
  const barcode = "4800361419116";
  await api("/companies/signup", {
    company_name: `${code} Store`,
    company_code: code,
    owner_full_name: "Ada Admin",
    owner_email: email,
    owner_username: "ada",
    owner_password: PASSWORD,
  });
  const login = await api<{ access_token: string }>("/auth/login", { email, password: PASSWORD });
  await api("/suppliers", { code: "SUP1", name: "Metro Distributors" }, login.access_token);

  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Category
  await page.goto("/catalog");
  await page.getByRole("button", { name: "New category" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Drinks");
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("cell", { name: "Drinks" })).toBeVisible();

  // Product with barcode and price
  await page.goto("/products/new");
  await page.getByLabel("Name", { exact: true }).fill("E2E Cola 1.5L");
  await choose(page, "Category", "Drinks");
  await choose(page, /Base unit/, /^PC · Piece/);
  await page.getByLabel("Unit cost").fill("60");
  await page.getByLabel(/^Barcodes/).fill(barcode);
  await page.getByLabel("Price", { exact: true }).fill("75.00");
  await page.getByRole("button", { name: "Create product" }).click();
  await expect(page.getByRole("heading", { name: "E2E Cola 1.5L" })).toBeVisible();
  await expect(page.getByText(barcode).first()).toBeVisible();

  // Search by barcode
  await page.goto("/products");
  await page.getByLabel("Search name, SKU or barcode").fill(barcode);
  await expect(page.getByRole("cell", { name: "E2E Cola 1.5L", exact: true })).toBeVisible();
  await expect(page.getByRole("cell", { name: "₱75.00" })).toBeVisible();

  // Purchase order (item added by scanning the barcode into the picker)
  await page.goto("/purchase-orders/new");
  await choose(page, "Supplier", /Metro Distributors/);
  await choose(page, "Stock location", /default/);
  const picker = page.getByLabel("Search or scan an item");
  await picker.fill(barcode);
  await picker.press("Enter");
  await expect(page.getByText("E2E Cola 1.5L")).toBeVisible();
  await page.getByLabel("Qty").fill("24");
  await page.getByLabel("Unit cost").fill("58.50");
  await expect(page.getByText("₱1,404.00")).toBeVisible();
  await page.getByRole("button", { name: "Create draft" }).click();
  await expect(page.getByRole("heading", { name: /^PO-000001/ })).toBeVisible();

  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText("Approved", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Receive quantity line 1")).toHaveValue("24");
  await page.getByLabel("Supplier invoice no.").fill("INV-77");
  await page.getByRole("button", { name: "Post receipt" }).click();
  await expect(page.getByText("Received", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "GR-000001" })).toBeVisible();

  // Stock balance
  await page.goto("/inventory");
  const row = page.getByRole("row", { name: /E2E Cola 1\.5L/ });
  await expect(row).toContainText("24");

  // Report + CSV export
  await page.goto("/reports/sales-summary");
  await expect(page.getByText("Transactions")).toBeVisible();
  await expect(page.getByText("Gross profit")).toBeVisible();
  await page.getByRole("button", { name: "Export CSV" }).click();
  const downloadButton = page.getByRole("button", { name: "Download CSV" });
  await expect(downloadButton).toBeVisible({ timeout: 20_000 });
  const [download] = await Promise.all([page.waitForEvent("download"), downloadButton.click()]);
  expect(download.suggestedFilename()).toMatch(/^sales-summary_.*\.csv$/);
  const path = await download.path();
  const { readFile } = await import("node:fs/promises");
  const csv = await readFile(path, "utf8");
  expect(csv.split(/\r?\n/)[0]).toBe("metric,value");
  expect(csv).toContain("transactions,0");
});
