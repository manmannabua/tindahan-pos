/**
 * Browser-side helpers for driving the POS terminal in e2e tests.
 */
import { expect, type Page } from "@playwright/test";

import { CASHIER_PIN, PASSWORD, type SeededCompany } from "./api";

/** Register this browser profile as a terminal and download the catalog. */
export async function setupTerminal(page: Page, company: SeededCompany, terminalCode: string): Promise<void> {
  await page.goto("/pos/setup");
  await page.getByLabel("Email").fill(company.email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Terminal code").fill(terminalCode);
  await page.getByLabel("Terminal name").fill(`Counter ${terminalCode}`);
  await page.getByRole("button", { name: "Register terminal" }).click();
  await expect(page.getByText("POS READY FOR OFFLINE USE")).toBeVisible({ timeout: 60_000 });
  await page.getByRole("link", { name: "Open terminal" }).click();
}

export async function pinLogin(page: Page, fullName: string, pin = CASHIER_PIN): Promise<void> {
  await page.getByRole("button", { name: new RegExp(fullName) }).click();
  await page.getByLabel("PIN").fill(pin);
  await page.getByRole("button", { name: "OK" }).click();
}

export async function openCashSession(page: Page, float = "1000.00"): Promise<void> {
  await page.getByLabel("Opening float").fill(float);
  await page.getByRole("button", { name: "Open session" }).click();
  await expect(page.getByLabel("Scan or search")).toBeVisible();
}

/** Type like a HID scanner (fast keystrokes + Enter) into the focused scan input. */
export async function scan(page: Page, code: string): Promise<void> {
  const input = page.getByLabel("Scan or search");
  await expect(input).toBeFocused();
  await page.keyboard.type(code, { delay: 8 });
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("");
}

export type Tender = { method: "Cash"; amount?: string } | { method: "GCash"; amount?: string; reference: string };

export async function pay(page: Page, tenders: Tender[]): Promise<void> {
  await page.getByRole("button", { name: "Pay" }).click();
  const dialog = page.getByRole("dialog");
  for (const tender of tenders) {
    await dialog.getByRole("button", { name: tender.method, exact: true }).click();
    if (tender.method === "GCash") await dialog.getByLabel("Reference number").fill(tender.reference);
    const amount = dialog.getByLabel(tender.method === "Cash" ? "Cash received" : "Amount");
    await amount.fill(tender.amount ?? "");
    await amount.press("Enter");
  }
  await expect(page.getByText(/Sale complete ·/)).toBeVisible();
  await page.getByRole("button", { name: "Next customer" }).click();
  await expect(page.getByText(/Sale complete ·/)).toBeHidden();
}

/** Counts of IndexedDB rows in the terminal database. */
export async function localCounts(page: Page): Promise<{ sales: number; outboxPending: number; outboxSynced: number; deviceId: string }> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("pos-terminal");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction(["sales", "outbox", "meta"], "readonly");
          const out = { sales: 0, outboxPending: 0, outboxSynced: 0, deviceId: "" };
          tx.objectStore("sales").count().onsuccess = (e) => {
            out.sales = (e.target as IDBRequest<number>).result;
          };
          tx.objectStore("outbox").getAll().onsuccess = (e) => {
            const rows = (e.target as IDBRequest<{ status: string }[]>).result;
            out.outboxPending = rows.filter((r) => r.status === "PENDING" || r.status === "SYNCING").length;
            out.outboxSynced = rows.filter((r) => r.status === "SYNCED").length;
          };
          tx.objectStore("meta").get("device").onsuccess = (e) => {
            out.deviceId = ((e.target as IDBRequest<{ value?: { deviceId: string } }>).result?.value?.deviceId) ?? "";
          };
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
        };
      }),
  );
}

/** Make the API unreachable (FastAPI down) while the web app itself still loads. */
export async function takeApiOffline(page: Page): Promise<void> {
  await page.route("**/api/**", (route) => route.abort("connectionrefused"));
  // Browser hint so the status flips immediately instead of after two failed health probes.
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("status")).toContainText("OFFLINE");
}

export async function bringApiBack(page: Page): Promise<void> {
  await page.unroute("**/api/**");
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

export async function waitUntilSynced(page: Page, timeout = 90_000): Promise<void> {
  await expect
    .poll(async () => (await localCounts(page)).outboxPending, { timeout, intervals: [500, 1000, 2000] })
    .toBe(0);
}
