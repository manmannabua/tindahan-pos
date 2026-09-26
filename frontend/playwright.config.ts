import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. `pnpm test:e2e` starts the Next dev server; the FastAPI backend must be
 * running separately (see ../README.md). Offline scenarios block `/api/**` with page.route().
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      // PW_CHANNEL=chrome uses the installed (signed) Google Chrome instead of Playwright's
      // downloaded Chromium — needed where Windows Smart App Control blocks unsigned binaries.
      use: { ...devices["Desktop Chrome"], channel: process.env.PW_CHANNEL || undefined },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:3000/login",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
