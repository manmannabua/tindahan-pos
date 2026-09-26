import { expect, test } from "@playwright/test";

/** Requires the FastAPI backend (see playwright.config.ts). Creates a fresh company per run. */
test("sign up, manage branches and users, sign out", async ({ page }) => {
  const code = `E2E${Date.now().toString(36).toUpperCase().slice(-6)}`;
  const email = `owner-${code.toLowerCase()}@example.com`;

  await page.goto("/signup");
  await page.getByLabel("Business name").fill("E2E Store");
  await page.getByLabel("Company code").fill(code);
  await page.getByLabel("Full name").fill("Erin Owner");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Username").fill("erin");
  await page.getByLabel("Password", { exact: true }).fill("correct-horse-battery");
  await page.getByLabel("Confirm password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create business" }).click();

  // Onboarding wizard: business → store → features (Basic preset) → next steps.
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 30_000 }); // first visit compiles the page in dev
  await expect(page.getByRole("heading", { name: /Let's set up your store/ })).toBeVisible();
  await page.getByRole("textbox", { name: "TIN" }).fill("123-456-789-000");
  await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled(); // VAT must be answered
  await page.getByRole("radio", { name: /No, not VAT-registered/ }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("textbox", { name: "Address" }).fill("123 Rizal Ave, Manila");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("radio", { name: /^Basic/ }).click();
  await expect(page.getByRole("switch", { name: "Expenses" })).not.toBeChecked();
  await expect(page.getByRole("switch", { name: "Stock tracking" })).toBeChecked();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("heading", { name: "You're set up" })).toBeVisible();
  await page.getByRole("button", { name: "Go to dashboard" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Welcome, Erin" })).toBeVisible();

  // Switched-off features are gone from the menu, and their pages say so.
  const menu = page.getByRole("navigation", { name: "Main" });
  await expect(menu.getByRole("link", { name: "Stock", exact: true })).toBeVisible();
  for (const name of ["Purchase orders", "Customers", "Expenses", "Promotions", "Online catalog"]) {
    await expect(menu.getByRole("link", { name })).toHaveCount(0);
  }
  await page.goto("/expenses");
  await expect(page.getByRole("heading", { name: "Expenses is turned off" })).toBeVisible();

  // The owner switches Expenses on in Settings → Features.
  await page.getByRole("link", { name: "Open Features" }).click();
  await page.getByRole("switch", { name: "Expenses" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText(/Features saved/)).toBeVisible();
  await expect(menu.getByRole("link", { name: "Expenses" })).toBeVisible();

  // Session survives a reload (access token is memory-only; restored from the refresh cookie).
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Welcome, Erin" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome, Erin" })).toBeVisible();

  // Create a branch.
  await page.getByRole("link", { name: "Branches" }).first().click();
  await expect(page.getByRole("cell", { name: "MAIN", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "New branch" }).click();
  await page.getByLabel("Code").fill("B2");
  await page.getByLabel("Name").fill("Second Branch");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { name: "B2 · Second Branch" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "STORE", exact: true })).toBeVisible();

  // Users page lists the owner.
  await page.getByRole("link", { name: "Users" }).first().click();
  await expect(page.getByText("@erin")).toBeVisible();

  // Sign out.
  await page.getByRole("button", { name: "Account menu" }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});
