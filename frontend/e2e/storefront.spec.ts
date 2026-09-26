import { expect, test } from "@playwright/test";

import { API_URL, PASSWORD, seedCompany } from "./support/api";

/**
 * Online catalog: the owner publishes the catalog and one product; an anonymous shopper sees
 * only that product, searches, and sees stock go out once the store's stock changes.
 * (Requires the backend, started with RATE_LIMIT_ENABLED=false.)
 */

async function post(path: string, token: string, body: unknown): Promise<void> {
  const response = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Requested-With": "pos", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${path} → ${response.status}: ${await response.text()}`);
}

test("owner publishes; shopper browses live stock", async ({ page, browser }) => {
  test.setTimeout(150_000);
  const company = await seedCompany({
    products: [
      { name: "Kape Barako 250g", price: "185.00", stock: "10" },
      { name: "Secret Supplier Item", price: "99.00", stock: "5" },
    ],
  });
  const slug = `e2e-${company.code.toLowerCase()}`;
  const [kape, secret] = company.products;

  // Owner: publish the catalog.
  await page.goto("/login");
  await page.getByLabel("Email").fill(company.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/online-catalog");
  await page.getByLabel("Link name").fill(slug);
  await page.getByRole("switch", { name: "Publish online catalog" }).click();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Online catalog saved and published")).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect(page.getByText(`/s/${slug}`).first()).toBeVisible();

  // Owner: show one product online (bulk selection on the products table).
  await page.goto("/products");
  await page.getByRole("checkbox", { name: `Select ${kape.name}` }).click();
  await page.getByRole("button", { name: "Show online" }).click();
  await expect(page.getByText("1 product shown online")).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(kape.name) }).getByText("Online")).toBeVisible();

  // Shopper: anonymous browser, no login.
  const shopper = await browser.newContext();
  const shop = await shopper.newPage();
  await shop.goto(`/s/${slug}`);
  await expect(shop.getByRole("heading", { name: `${company.code} Mart` })).toBeVisible();
  const card = shop.getByRole("button", { name: new RegExp(kape.name) });
  await expect(card).toBeVisible();
  await expect(card.getByText("₱185.00")).toBeVisible();
  await expect(card.getByText("In stock")).toBeVisible();
  await expect(shop.getByText(secret.name)).toHaveCount(0);

  // Search (shareable URL) and product details.
  await shop.getByLabel("Search products").fill("zzz-nothing");
  await expect(shop.getByText("No products found")).toBeVisible();
  await expect(shop).toHaveURL(/\?q=zzz-nothing$/);
  await shop.getByLabel("Search products").fill("barako");
  await card.click();
  await expect(shop.getByRole("dialog").getByRole("heading", { name: kape.name })).toBeVisible();
  await shop.keyboard.press("Escape");

  // The store sells out (an adjustment here; POS sales reach the same stock balance via sync).
  await post("/inventory/adjustments", company.token, {
    stock_location_id: company.locationId,
    reason: "Sold out at the counter",
    lines: [{ variant_id: kape.variantId, quantity: "10", reason: "ADJUSTMENT_OUT" }],
  });
  // Public responses are cached for up to 30 s; the page refreshes itself every 60 s.
  await expect(async () => {
    await shop.reload();
    await expect(shop.getByRole("button", { name: new RegExp(kape.name) }).getByText("Out of stock")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000, intervals: [5_000] });

  // Unknown stores look like any missing page.
  await shop.goto("/s/no-such-store-e2e");
  await expect(shop.getByRole("heading", { name: "Store not found" })).toBeVisible();
  await shopper.close();
});
