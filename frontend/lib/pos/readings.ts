/**
 * BIR-style terminal readings from local data (works offline).
 *
 * - X-reading: interim report for a period (e.g. the current shift). Printing it changes nothing.
 * - Z-reading: end-of-day report covering everything since the previous Z-reading. Printing it
 *   increments the Z counter and moves the "since" boundary; nothing is ever deleted.
 *
 * The accumulated grand total is the non-resettable counter kept in `meta.grandTotal`
 * (incremented inside completeSale, decremented by a local void) — the same definition as the
 * server's GET /reports/terminal-reading: completed sales only. Old grand total = new − net sales
 * of the period.
 */
import { getMeta, setMeta } from "@/lib/db/meta";
import type { PaymentKind, PosDatabase } from "@/lib/db/schema";
import { add, subtract, toMoneyString } from "@/lib/money";

export type ReadingKind = "X" | "Z";

export interface TerminalReading {
  kind: ReadingKind;
  /** Z-reading number (only for Z). */
  zNumber: number | null;
  from: string | null;
  to: string;
  firstReceipt: string | null;
  lastReceipt: string | null;
  transactions: number;
  grossSales: string;
  regularDiscounts: string;
  scPwdDiscounts: string;
  vatExemptions: string;
  returns: string;
  voidsCount: number;
  voidsAmount: string;
  netSales: string;
  vatableSales: string;
  vatAmount: string;
  exemptSales: string;
  zeroRatedSales: string;
  payments: { kind: PaymentKind; amount: string }[];
  oldGrandTotal: string;
  newGrandTotal: string;
}

const inRange = (at: string, from: string | null, to: string) => (from === null || at >= from) && at <= to;

/** Compute a reading for sales that occurred in (from, to]. `from` null = since the beginning. */
export async function computeReading(
  db: PosDatabase,
  args: { kind: ReadingKind; from: string | null; to: string; zNumber?: number | null },
): Promise<TerminalReading> {
  const { from, to } = args;
  const sales = (await db.sales.toArray()).filter((s) => inRange(s.occurredAt, from, to));
  const completed = sales.filter((s) => s.status === "COMPLETED");
  const voidedInPeriod = (await db.sales.toArray()).filter(
    (s) => s.status === "VOIDED" && s.voidedAt && inRange(s.voidedAt, from, to),
  );
  const returns = (await db.returns.toArray()).filter((r) => inRange(r.occurredAt, from, to));

  const sum = (values: string[]) => toMoneyString(add("0", ...values));
  const payments = new Map<PaymentKind, string>();
  for (const sale of completed) {
    for (const p of await db.payments.where("saleId").equals(sale.id).toArray()) {
      payments.set(p.methodKind, toMoneyString(add(payments.get(p.methodKind) ?? "0", p.amount)));
    }
  }
  const receipts = sales.map((s) => s.receiptNumber).sort();
  const netSales = sum(completed.map((s) => s.total));
  const scPwd = sum(completed.map((s) => s.statutoryDiscountTotal ?? "0"));
  const newGrand = (await getMeta(db, "grandTotal")) ?? "0";
  return {
    kind: args.kind,
    zNumber: args.zNumber ?? null,
    from,
    to,
    firstReceipt: receipts[0] ?? null,
    lastReceipt: receipts.at(-1) ?? null,
    transactions: completed.length,
    grossSales: sum(completed.map((s) => s.grossTotal)),
    regularDiscounts: toMoneyString(subtract(sum(completed.map((s) => s.discountTotal)), scPwd)),
    scPwdDiscounts: scPwd,
    vatExemptions: sum(completed.map((s) => s.vatExemptionTotal ?? "0")),
    returns: sum(returns.map((r) => r.refundTotal)),
    voidsCount: voidedInPeriod.length,
    voidsAmount: sum(voidedInPeriod.map((s) => s.total)),
    netSales,
    vatableSales: sum(completed.map((s) => s.vatableSales)),
    vatAmount: sum(completed.map((s) => s.vatAmount)),
    exemptSales: sum(completed.map((s) => s.exemptSales)),
    zeroRatedSales: sum(completed.map((s) => s.zeroRatedSales)),
    payments: [...payments.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, amount]) => ({ kind, amount })),
    oldGrandTotal: toMoneyString(subtract(newGrand, netSales)),
    newGrandTotal: toMoneyString(newGrand),
  };
}

/** X-reading of a period (e.g. the open shift); changes nothing. */
export function xReading(db: PosDatabase, from: string | null, now: Date = new Date()): Promise<TerminalReading> {
  return computeReading(db, { kind: "X", from, to: now.toISOString() });
}

/**
 * Z-reading since the previous Z-reading. Records the new boundary and Z counter in the same
 * transaction, so two Z-readings can never cover the same sales.
 */
export async function zReading(db: PosDatabase, now: Date = new Date()): Promise<TerminalReading> {
  return db.transaction("rw", [db.meta, db.sales, db.payments, db.returns], async () => {
    const from = (await getMeta(db, "lastZAt")) ?? null;
    const zNumber = ((await getMeta(db, "zCount")) ?? 0) + 1;
    const reading = await computeReading(db, { kind: "Z", from, to: now.toISOString(), zNumber });
    await setMeta(db, "zCount", zNumber);
    await setMeta(db, "lastZAt", reading.to);
    await setMeta(db, "lastZGrandTotal", reading.newGrandTotal);
    return reading;
  });
}
