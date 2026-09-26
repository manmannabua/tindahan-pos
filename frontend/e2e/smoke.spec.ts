import { expect, test } from "@playwright/test";

test("login page renders", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("POS shell renders and reports offline when the API is unreachable", async ({ page }) => {
  await page.route("**/api/**", (route) => route.abort());
  await page.goto("/pos");
  await expect(page.getByRole("status")).toContainText("OFFLINE", { timeout: 20_000 });
});
