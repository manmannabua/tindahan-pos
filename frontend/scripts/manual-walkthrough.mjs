// Manual walkthrough against the running dev servers (localhost:3000 + API on :8000).
// Drives installed Chrome, saves a screenshot per step. Not part of the test suite.
//   node scripts/manual-walkthrough.mjs <screenshot-dir>
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] ?? "walkthrough";
fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000";
let step = 0;
const errors = [];

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1366, height: 800 } });
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

async function shot(name) {
  step += 1;
  const file = path.join(out, `${String(step).padStart(2, "0")}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log("screenshot", file);
}

async function run(name, fn) {
  try {
    await fn();
    console.log("OK  ", name);
  } catch (e) {
    console.log("FAIL", name, "-", e.message.split("\n")[0]);
    await shot(`FAIL-${name.replace(/\W+/g, "-")}`);
  }
}

await run("admin login", async () => {
  await page.goto(`${BASE}/login`);
  await shot("login");
  await page.getByLabel(/email/i).fill("owner@demo.example.com");
  await page.getByLabel(/password/i).fill("demo-password-123");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await shot("dashboard");
});

for (const [name, url] of [
  ["products", "/products"],
  ["inventory", "/inventory"],
  ["reports", "/reports"],
  ["users", "/users"],
  ["devices", "/devices"],
]) {
  await run(`admin page ${name}`, async () => {
    await page.goto(`${BASE}${url}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(800);
    await shot(name);
  });
}

console.log("\nERRORS:\n" + (errors.length ? errors.join("\n") : "none"));
await browser.close();
