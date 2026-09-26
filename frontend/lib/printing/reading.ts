import type { DeviceBir } from "@/lib/db/meta";
import type { LocalBranch, LocalCompany } from "@/lib/db/schema";
import type { TerminalReading } from "@/lib/pos/readings";
import { toMoneyString } from "@/lib/money";

import { birHeaderLines, type ReceiptDocument, type ReceiptLine, type ReceiptWidth } from "./receipt";

const PAYMENT_LABELS: Record<string, string> = {
  CASH: "Cash",
  EWALLET: "E-wallet",
  CARD: "Card",
  BANK: "Bank",
  OTHER: "Other",
};

/** X/Z reading slip (same layout pipeline as receipts). */
export function buildReadingDocument(
  reading: TerminalReading,
  args: {
    company: LocalCompany;
    branch: LocalBranch;
    terminalCode: string;
    deviceBir: DeviceBir | null;
    printedBy: string;
    width: ReceiptWidth;
  },
): ReceiptDocument {
  const m = (v: string) => toMoneyString(v);
  const title = reading.kind === "Z" ? `Z-READING #${reading.zNumber ?? ""}` : "X-READING";
  const lines: ReceiptLine[] = [
    ...birHeaderLines(args.company, args.branch, args.deviceBir),
    { kind: "center", text: title, bold: true },
    { kind: "rule" },
    { kind: "pair", left: "Terminal", right: args.terminalCode },
    { kind: "pair", left: "From", right: reading.from ? new Date(reading.from).toLocaleString("en-PH") : "Start" },
    { kind: "pair", left: "To", right: new Date(reading.to).toLocaleString("en-PH") },
    { kind: "pair", left: "Printed by", right: args.printedBy },
    { kind: "pair", left: "Beginning receipt", right: reading.firstReceipt ?? "-" },
    { kind: "pair", left: "Ending receipt", right: reading.lastReceipt ?? "-" },
    { kind: "rule" },
    { kind: "pair", left: "Transactions", right: String(reading.transactions) },
    { kind: "pair", left: "Gross sales", right: m(reading.grossSales) },
    { kind: "pair", left: "Less: regular discounts", right: m(reading.regularDiscounts) },
    { kind: "pair", left: "Less: SC/PWD discounts", right: m(reading.scPwdDiscounts) },
    { kind: "pair", left: "Less: VAT exemptions", right: m(reading.vatExemptions) },
    { kind: "pair", left: "Net sales", right: m(reading.netSales), bold: true },
    { kind: "pair", left: "Returns / refunds", right: m(reading.returns) },
    { kind: "pair", left: `Voids (${reading.voidsCount})`, right: m(reading.voidsAmount) },
    { kind: "rule" },
    { kind: "pair", left: "VATable sales", right: m(reading.vatableSales) },
    { kind: "pair", left: "VAT amount", right: m(reading.vatAmount) },
    { kind: "pair", left: "VAT-exempt sales", right: m(reading.exemptSales) },
    { kind: "pair", left: "Zero-rated sales", right: m(reading.zeroRatedSales) },
    { kind: "rule" },
    ...reading.payments.map((p) => ({ kind: "pair", left: PAYMENT_LABELS[p.kind] ?? p.kind, right: m(p.amount) }) as const),
    { kind: "rule" },
    { kind: "pair", left: "Old grand total", right: m(reading.oldGrandTotal) },
    { kind: "pair", left: "New grand total", right: m(reading.newGrandTotal), bold: true },
  ];
  return { width: args.width, lines };
}
