// POS walkthrough against the running dev servers with the DEMO company (seed-dev + sample
// catalog). Registers a terminal, sells online, sells offline (incl. a senior citizen sale),
// reconnects and checks the server. Saves a screenshot per step. Not part of the test suite.
//   node scripts/manual-walkthrough-pos.mjs <screenshot-dir>
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const out = process.argv[2] ?? "walkthrough-pos";
fs.mkdirSync(out, { recursive: true });
const BASE = "http://localhost:3000";
const API = "http://localhost:8000/api/v1";
const errors = [];
const TERMINAL = process.env.TERMINAL ?? "T01";
let step = 0;

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ viewport: { width: 1366, height: 800 } });
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const shot = async (name) => {
  step += 1;
  await page.screenshot({ path: path.join(out, `${String(step).padStart(2, "0")}-${name}.png`) });
};
const run = async (name, fn) => {
  try {
    await fn();
    console.log("OK  ", name);
  } catch (e) {
    console.log("FAIL", name, "-", e.message.split("\n")[0]);
    await shot(`FAIL-${name.replace(/\W+/g, "-")}`);
    throw e;
  }
};
const scan = async (code) => {
  const input = page.getByLabel("Scan or search");
  await input.focus();
  await page.keyboard.type(code, { delay: 8 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
};
const payCash = async (amount) => {
  await page.getByRole("button", { name: "Pay" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Cash", exact: true }).click();
  const input = dialog.getByLabel("Cash received");
  await input.fill(amount);
  await input.press("Enter");
  await page.getByText(/Sale complete ·/).waitFor();
};
const nextCustomer = async () => {
  await page.getByRole("button", { name: "Next customer" }).click();
  await page.getByText(/Sale complete ·/).waitFor({ state: "hidden" });
};

async function adminToken() {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-requested-with": "pos" },
    body: JSON.stringify({ email: "owner@demo.example.com", password: "demo-password-123" }),
  });
  return (await r.json()).access_token;
}
async function api(pathname, token) {
  const r = await fetch(`${API}${pathname}`, { headers: { authorization: `Bearer ${token}`, "x-requested-with": "pos" } });
  return r.json();
}

try {
  await run("terminal setup", async () => {
    await page.goto(`${BASE}/pos/setup`);
    await shot("setup-login");
    await page.getByLabel("Email").fill("owner@demo.example.com");
    await page.getByLabel("Password").fill("demo-password-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.getByLabel("Terminal code").fill(TERMINAL);
    await page.getByLabel("Terminal name").fill(`Counter ${TERMINAL}`);
    await shot("setup-register");
    await page.getByRole("button", { name: "Register terminal" }).click();
    await page.getByText("POS READY FOR OFFLINE USE").waitFor({ timeout: 60000 });
    await shot("setup-ready");
    await page.getByRole("link", { name: "Open terminal" }).click();
  });

  await run("cashier PIN login + open session", async () => {
    await page.getByRole("button", { name: /Carlo Cashier/ }).waitFor();
    await shot("pin-staff-list");
    await page.getByRole("button", { name: /Carlo Cashier/ }).click();
    await page.getByLabel("PIN").fill("135790");
    await page.getByRole("button", { name: "OK" }).click();
    await page.getByLabel("Opening float").fill("1000.00");
    await shot("open-session");
    await page.getByRole("button", { name: "Open session" }).click();
    await page.getByLabel("Scan or search").waitFor();
  });

  await run("online sale by scanning", async () => {
    await scan("4801981118502"); // Coke
    await scan("4800361002769"); // Nescafe
    await scan("4801981118502"); // Coke again → quantity 2
    await shot("cart-online");
    await payCash("250");
    await shot("sale-complete-online");
    await nextCustomer();
  });

  await run("API goes down", async () => {
    await page.route("**/api/**", (route) => route.abort("connectionrefused"));
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.getByRole("status").filter({ hasText: "OFFLINE" }).waitFor();
  });

  await run("offline sale (UPC-A scan + weighed rice by search)", async () => {
    await scan("748485100111"); // Century Tuna, printed as UPC-A
    await scan("4807770270291"); // Lucky Me
    await scan("4807770270291");
    await scan("4807770270291");
    await shot("cart-offline");
    await payCash("200");
    await shot("sale-complete-offline");
    await nextCustomer();
  });

  await run("offline senior citizen sale", async () => {
    for (let i = 0; i < 10; i++) await scan("4806503300012"); // 10 x Biogesic
    await scan("4902430710937"); // Safeguard (not eligible)
    await page.getByRole("button", { name: "Senior / PWD" }).click();
    await page.getByLabel("OSCA / Senior citizen ID no.").fill("OSCA-2026-0042");
    await page.getByLabel("Name of holder").fill("Lola Nena Santos");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForTimeout(300);
    await shot("cart-senior");
    await payCash("100");
    await shot("sale-complete-senior");
    await nextCustomer();
  });

  await run("reload while offline: sales survive", async () => {
    await page.reload();
    await page.getByRole("button", { name: /Carlo Cashier/ }).click();
    await page.getByLabel("PIN").fill("135790");
    await page.getByRole("button", { name: "OK" }).click();
    await page.getByRole("button", { name: "Sales" }).click();
    await page.waitForTimeout(500);
    await shot("sales-history-offline");
    const rows = await page.getByTestId("sale-row").count();
    if (rows !== 3) throw new Error(`expected 3 local sales, found ${rows}`);
  });

  await run("API back → sync", async () => {
    await page.unroute("**/api/**");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByRole("button", { name: "Sync" }).click();
    await page.getByText("Everything is synced.").waitFor({ timeout: 90000 });
    await page.getByRole("status").filter({ hasText: "ONLINE" }).waitFor({ timeout: 30000 });
    await shot("synced");
  });

  await run("server has the sales", async () => {
    const token = await adminToken();
    const deviceId = await page.evaluate(() => new Promise((resolve) => {
      const open = indexedDB.open("pos-terminal");
      open.onsuccess = () => {
        const req = open.result.transaction("meta").objectStore("meta").get("device");
        req.onsuccess = () => resolve(req.result?.value?.deviceId ?? "");
      };
    }));
    const sales = await api(`/sales?limit=50&device_id=${deviceId}`, token);
    console.log("   server sales:", sales.total, sales.items.map((s) => `${s.receipt_number}=${s.total}`).join(", "));
    const summary = await api("/reports/sales-summary", token);
    console.log("   summary:", JSON.stringify({
      transactions: summary.data.transactions, sales: summary.data.sales, tax: summary.data.tax,
      sc_pwd: summary.data.sc_pwd_discounts, vat_exemptions: summary.data.vat_exemptions,
      gross_profit: summary.data.gross_profit,
    }));
    const flags = await api("/review-flags", token);
    console.log("   open review flags:", flags.items.map((f) => f.flag_type).join(", ") || "none");
    if (sales.total !== 3) throw new Error(`expected 3 server sales, got ${sales.total}`);
  });

  await run("admin dashboard after sync", async () => {
    const admin = await context.newPage();
    await admin.goto(`${BASE}/login`);
    await admin.getByLabel(/email/i).fill("owner@demo.example.com");
    await admin.getByLabel(/password/i).fill("demo-password-123");
    await admin.getByRole("button", { name: /sign in|log in/i }).click();
    await admin.waitForURL(/dashboard/);
    await admin.waitForTimeout(2000);
    step += 1;
    await admin.screenshot({ path: path.join(out, `${String(step).padStart(2, "0")}-dashboard-after.png`) });
  });
} catch {
  // failure already reported
}

console.log("\nERRORS:\n" + (errors.length ? [...new Set(errors)].join("\n") : "none"));
await browser.close();
