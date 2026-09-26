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

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole("heading", { name: "Welcome, Erin" })).toBeVisible();

  // Session survives a reload (access token is memory-only; restored from the refresh cookie).
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
