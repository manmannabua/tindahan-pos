/**
 * Receipt journal ("virtual receipts"): every receipt this terminal issues is stored locally
 * exactly as laid out at the time — printed or not — and synced to the server (append-only).
 *
 * - `addReceipt` runs INSIDE the checkout / return transaction, so a sale can never exist without
 *   its receipt (and vice versa).
 * - `printFromJournal` prints the stored copy (never a re-rendering) and records the print.
 * - `ensureJournal` back-fills entries for sales/returns made before the journal existed; those are
 *   marked `reconstructed` because they are rebuilt from today's header data.
 */
import { v7 as uuidv7 } from "uuid";

import type { PosContext } from "@/lib/db/context";
import type { LocalReceipt, PosDatabase, ReceiptPrintState } from "@/lib/db/schema";
import { printDocument } from "@/lib/printing/output";
import type { ReceiptDocument } from "@/lib/printing/receipt";
import { buildReturnReceipt } from "@/lib/printing/return-receipt";
import { enqueue, PRIORITY } from "@/lib/sync/outbox";
import type { ReceiptIssuePayload, ReceiptPrintPayload } from "@/types/sync";

import { derivedId } from "./ids";
import { loadReceipt } from "./receipts";

export function journalId(sourceId: string): string {
  return derivedId(sourceId, "RECEIPT");
}

export interface NewReceipt {
  kind: "SALE" | "RETURN";
  number: string;
  saleId: string | null;
  returnId: string | null;
  issuedAt: string;
  total: string;
  cashierName: string;
  doc: ReceiptDocument;
  reconstructed?: boolean;
}

/** Store a receipt and queue it for the server. Call inside the caller's Dexie transaction. */
export async function addReceipt(db: PosDatabase, input: NewReceipt, deviceId: string, now?: Date): Promise<LocalReceipt> {
  const receipt: LocalReceipt = {
    id: journalId(input.returnId ?? input.saleId ?? input.number),
    kind: input.kind,
    number: input.number,
    saleId: input.saleId,
    returnId: input.returnId,
    issuedAt: input.issuedAt,
    total: input.total,
    cashierName: input.cashierName,
    width: input.doc.width,
    lines: input.doc.lines,
    reconstructed: input.reconstructed ?? false,
    printState: "NOT_PRINTED",
    printCount: 0,
    lastPrintedAt: null,
    lastPrintError: null,
    syncStatus: "PENDING",
  };
  await db.receipts.add(receipt);
  const payload: ReceiptIssuePayload = {
    id: receipt.id,
    kind: receipt.kind,
    number: receipt.number,
    sale_id: receipt.saleId,
    return_id: receipt.returnId,
    issued_at: receipt.issuedAt,
    width: receipt.width,
    lines: receipt.lines,
    total: receipt.total,
    cashier_name: receipt.cashierName,
    reconstructed: receipt.reconstructed,
  };
  await enqueue(db, {
    deviceId,
    entityType: "receipt",
    entityId: receipt.id,
    operation: "receipt.issue",
    payload,
    priority: PRIORITY.RECEIPT,
    now,
  });
  return receipt;
}

/** The stored receipt as a printable document; reprints get a REPRINT marker after the header. */
export function journalDocument(receipt: Pick<LocalReceipt, "width" | "lines">, reprint = false): ReceiptDocument {
  if (!reprint) return { width: receipt.width, lines: receipt.lines };
  const lines = [...receipt.lines];
  const firstRule = lines.findIndex((l) => l.kind === "rule");
  lines.splice(firstRule < 0 ? 0 : firstRule, 0, { kind: "center", text: "*** REPRINT ***", bold: true });
  return { width: receipt.width, lines };
}

export interface JournalPrintResult {
  receipt: LocalReceipt;
  /** Set when the thermal printer failed and the browser printed instead. */
  fallbackReason: string | null;
}

/** Print the stored copy through the terminal's printer and record the print. */
export async function printFromJournal(
  db: PosDatabase,
  receiptId: string,
  context: Pick<PosContext, "settings" | "device">,
  options: { reprint?: boolean; kickDrawer?: boolean; now?: () => Date } = {},
): Promise<JournalPrintResult | null> {
  const receipt = await db.receipts.get(receiptId);
  if (!receipt) return null;
  const reprint = options.reprint ?? receipt.printCount > 0;
  const outcome = await printDocument(journalDocument(receipt, reprint), context.settings, { kickDrawer: options.kickDrawer });
  const method = context.settings.printerMode !== "browser" && !outcome.fallbackReason ? "ESCPOS" : "BROWSER";
  const now = (options.now?.() ?? new Date()).toISOString();
  const updated = await db.transaction("rw", [db.receipts, db.outbox], async () => {
    const current = (await db.receipts.get(receiptId)) ?? receipt;
    const printState: ReceiptPrintState = method === "ESCPOS" || current.printState === "PRINTED" ? "PRINTED" : "BROWSER";
    const changes = {
      printState,
      printCount: current.printCount + 1,
      lastPrintedAt: now,
      lastPrintError: outcome.fallbackReason,
    };
    await db.receipts.update(receiptId, changes);
    const payload: ReceiptPrintPayload = {
      id: uuidv7(),
      receipt_id: receiptId,
      printed_at: now,
      method,
      is_reprint: reprint,
      fallback_reason: outcome.fallbackReason?.slice(0, 300) ?? null,
    };
    await enqueue(db, {
      deviceId: context.device.deviceId,
      entityType: "receipt_print",
      entityId: payload.id,
      operation: "receipt.print",
      payload,
      priority: PRIORITY.RECEIPT_PRINT,
    });
    return { ...current, ...changes };
  });
  return { receipt: updated, fallbackReason: outcome.fallbackReason };
}

/**
 * Create journal entries for sales and returns on this terminal that don't have one (made before
 * the journal existed). Returns how many were added.
 */
export async function ensureJournal(db: PosDatabase, context: PosContext): Promise<number> {
  const have = new Set((await db.receipts.toArray()).flatMap((r) => [r.saleId, r.returnId]).filter(Boolean));
  const deviceId = context.device.deviceId;
  let added = 0;

  for (const sale of await db.sales.toArray()) {
    if (have.has(sale.id)) continue;
    const doc = await loadReceipt(db, sale.id, context, false);
    if (!doc) continue;
    await db.transaction("rw", [db.receipts, db.outbox], async () => {
      if (await db.receipts.get(journalId(sale.id))) return;
      await addReceipt(
        db,
        {
          kind: "SALE",
          number: sale.receiptNumber,
          saleId: sale.id,
          returnId: null,
          issuedAt: sale.occurredAt,
          total: sale.total,
          cashierName: sale.cashierName,
          doc,
          reconstructed: true,
        },
        deviceId,
      );
      added += 1;
    });
  }

  for (const ret of await db.returns.toArray()) {
    if (have.has(ret.id)) continue;
    const [items, refunds, sale] = await Promise.all([
      db.returnItems.where("returnId").equals(ret.id).toArray(),
      db.refunds.where("returnId").equals(ret.id).toArray(),
      db.sales.get(ret.saleId),
    ]);
    const doc = buildReturnReceipt({
      ret,
      items,
      refunds,
      originalReceipt: sale?.receiptNumber ?? "—",
      company: context.company,
      branch: context.branch,
      terminalCode: context.device.terminalCode,
      width: context.settings.receiptWidth,
      deviceBir: context.deviceBir,
    });
    await db.transaction("rw", [db.receipts, db.outbox], async () => {
      if (await db.receipts.get(journalId(ret.id))) return;
      await addReceipt(
        db,
        {
          kind: "RETURN",
          number: ret.returnNumber,
          saleId: ret.saleId,
          returnId: ret.id,
          issuedAt: ret.occurredAt,
          total: ret.refundTotal,
          cashierName: ret.cashierName,
          doc,
          reconstructed: true,
        },
        deviceId,
      );
      added += 1;
    });
  }
  return added;
}
