import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadPosContext, type PosContext } from "@/lib/db/context";
import type { PosDatabase } from "@/lib/db/schema";
import { buildReceipt, type ReceiptDocument } from "@/lib/printing/receipt";
import { coke, createTerminalDb, destroyDb, IDS, PRICE_CONTEXT } from "@/test-utils/terminal-fixture";
import type { ReceiptIssuePayload, ReceiptPrintPayload } from "@/types/sync";

import { addItem, EMPTY_CART } from "./cart";
import { completeSale, type CompleteSaleArgs } from "./complete-sale";
import { ensureJournal, journalDocument, journalId, printFromJournal } from "./journal";

const printDocument = vi.fn();
vi.mock("@/lib/printing/output", () => ({ printDocument: (...args: unknown[]) => printDocument(...args) }));

let db: PosDatabase;
let context: PosContext;

beforeEach(async () => {
  db = await createTerminalDb();
  context = await loadPosContext(db);
  printDocument.mockReset();
  printDocument.mockResolvedValue({ fallbackReason: null });
});
afterEach(async () => {
  await destroyDb(db);
});

async function saleArgs(withReceipt: boolean): Promise<CompleteSaleArgs> {
  const cash = await db.paymentMethods.get(IDS.cash);
  if (!cash) throw new Error("missing cash method");
  return {
    cart: addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT),
    tenders: [{ method: cash, amount: "75.00", tendered: "100.00" }],
    cashier: { id: IDS.cashier, name: "Cathy Cashier" },
    cashSessionId: null,
    priceLevelId: IDS.retail,
    pricesIncludeTax: true,
    deviceId: IDS.device,
    receiptPrefix: "MAIN-T01-",
    stockLocationId: IDS.location,
    now: new Date("2026-09-26T08:00:00Z"),
    buildReceipt: withReceipt
      ? (sale, items, payments) =>
          buildReceipt({
            sale,
            items,
            payments,
            company: context.company,
            branch: context.branch,
            terminalCode: "T01",
            width: 58,
          })
      : undefined,
  };
}

const printedDoc = (): ReceiptDocument => printDocument.mock.calls.at(-1)?.[0] as ReceiptDocument;

describe("receipt journal", () => {
  it("stores the receipt in the same transaction as the sale, unprinted, queued after the sale", async () => {
    const result = await completeSale(db, await saleArgs(true));
    expect(result.receiptId).toBe(journalId(result.sale.id));

    const receipt = await db.receipts.get(result.receiptId!);
    expect(receipt).toMatchObject({
      kind: "SALE",
      number: "MAIN-T01-000001",
      saleId: result.sale.id,
      total: "75.00",
      printState: "NOT_PRINTED",
      printCount: 0,
      reconstructed: false,
      syncStatus: "PENDING",
    });
    expect(receipt?.lines.some((l) => l.kind === "pair" && l.left === "TOTAL")).toBe(true);

    const ops = await db.outbox.orderBy("seq").toArray();
    expect(ops.map((o) => [o.operation, o.priority])).toEqual([
      ["sale.complete", 10],
      ["receipt.issue", 55],
    ]);
    const payload = ops[1].payload as ReceiptIssuePayload;
    expect(payload).toMatchObject({ id: receipt?.id, sale_id: result.sale.id, width: 58, total: "75.00" });
    expect(payload.lines).toEqual(receipt?.lines);
  });

  it("a failing receipt layout rolls the whole sale back (never a sale without its receipt)", async () => {
    const args = await saleArgs(true);
    args.buildReceipt = () => {
      throw new Error("layout failed");
    };
    await expect(completeSale(db, args)).rejects.toThrow("layout failed");
    expect(await db.sales.count()).toBe(0);
    expect(await db.receipts.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it("prints the stored copy and records every print; later prints are reprints", async () => {
    const { receiptId } = await completeSale(db, await saleArgs(true));

    const first = await printFromJournal(db, receiptId!, context, { now: () => new Date("2026-09-26T08:00:05Z") });
    expect(first?.receipt).toMatchObject({ printState: "BROWSER", printCount: 1, lastPrintedAt: "2026-09-26T08:00:05.000Z" });
    expect(printedDoc().lines.some((l) => l.kind === "center" && l.text.includes("REPRINT"))).toBe(false);

    const thermal = { ...context, settings: { ...context.settings, printerMode: "escpos-usb" as const } };
    const second = await printFromJournal(db, receiptId!, thermal);
    expect(second?.receipt).toMatchObject({ printState: "PRINTED", printCount: 2, lastPrintError: null });
    expect(printedDoc().lines.some((l) => l.kind === "center" && l.text === "*** REPRINT ***")).toBe(true);

    // Thermal printer fails → the browser prints; a confirmed PRINTED state is kept.
    printDocument.mockResolvedValueOnce({ fallbackReason: "Printer not paired" });
    const third = await printFromJournal(db, receiptId!, thermal);
    expect(third?.receipt).toMatchObject({ printState: "PRINTED", printCount: 3, lastPrintError: "Printer not paired" });

    const prints = (await db.outbox.orderBy("seq").filter((o) => o.entityType === "receipt_print").toArray()).map((o) => o.payload as ReceiptPrintPayload);
    expect(prints.map((p) => [p.method, p.is_reprint, p.fallback_reason])).toEqual([
      ["BROWSER", false, null],
      ["ESCPOS", true, null],
      ["BROWSER", true, "Printer not paired"],
    ]);
    expect(new Set(prints.map((p) => p.id)).size).toBe(3); // each print is its own event
  });

  it("back-fills sales made before the journal existed, once", async () => {
    const { sale } = await completeSale(db, await saleArgs(false));
    expect(await db.receipts.count()).toBe(0);

    expect(await ensureJournal(db, context)).toBe(1);
    const receipt = await db.receipts.get(journalId(sale.id));
    expect(receipt).toMatchObject({ number: sale.receiptNumber, reconstructed: true, printState: "NOT_PRINTED" });
    expect(await ensureJournal(db, context)).toBe(0);
    expect(await db.outbox.filter((o) => o.operation === "receipt.issue").count()).toBe(1);
  });

  it("marks reprints right after the header", () => {
    const doc = journalDocument(
      {
        width: 58,
        lines: [
          { kind: "center", text: "ACME" },
          { kind: "rule" },
          { kind: "pair", left: "TOTAL", right: "75.00" },
        ],
      },
      true,
    );
    expect(doc.lines.map((l) => l.kind)).toEqual(["center", "center", "rule", "pair"]);
  });
});
