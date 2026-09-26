import type { SessionSummary } from "@/lib/pos/cash-session";
import { toMoneyString } from "@/lib/money";

import type { ReceiptDocument, ReceiptLine, ReceiptWidth } from "./receipt";

/** Shift summary ("Z-read" style) for the cash drawer. */
export function buildZRead(summary: SessionSummary, args: { branchName: string; terminalCode: string; cashierName: string; width: ReceiptWidth }): ReceiptDocument {
  const s = summary.session;
  const lines: ReceiptLine[] = [
    { kind: "center", text: "CASH SESSION SUMMARY", bold: true },
    { kind: "center", text: args.branchName },
    { kind: "rule" },
    { kind: "pair", left: "Terminal", right: args.terminalCode },
    { kind: "pair", left: "Cashier", right: args.cashierName },
    { kind: "pair", left: "Opened", right: new Date(s.openedAt).toLocaleString("en-PH") },
    ...(s.closedAt ? [{ kind: "pair", left: "Closed", right: new Date(s.closedAt).toLocaleString("en-PH") } as const] : []),
    { kind: "rule" },
    { kind: "pair", left: "Sales", right: String(summary.saleCount) },
    { kind: "pair", left: "Sales total", right: toMoneyString(summary.salesTotal), bold: true },
    ...summary.byMethod.map((m) => ({ kind: "pair", left: `  ${m.name} (${m.count})`, right: toMoneyString(m.amount) }) as const),
    { kind: "pair", left: "Voided sales", right: String(summary.voidCount) },
    { kind: "pair", left: "Returns", right: String(summary.returnCount) },
    { kind: "rule" },
    { kind: "pair", left: "Opening float", right: toMoneyString(s.openingFloat) },
    { kind: "pair", left: "Cash sales", right: toMoneyString(summary.cashSales) },
    { kind: "pair", left: "Cash in", right: toMoneyString(summary.cashIn) },
    { kind: "pair", left: "Cash out", right: `-${toMoneyString(summary.cashOut)}` },
    { kind: "pair", left: "Pickups", right: `-${toMoneyString(summary.pickups)}` },
    { kind: "pair", left: "Cash refunds", right: `-${toMoneyString(summary.cashRefunds)}` },
    { kind: "pair", left: "Expected cash", right: toMoneyString(summary.expectedCash), bold: true },
  ];
  if (s.countedCash !== null && s.overShort !== null) {
    lines.push({ kind: "pair", left: "Counted cash", right: toMoneyString(s.countedCash) });
    lines.push({ kind: "pair", left: "Over / short", right: toMoneyString(s.overShort), bold: true });
  }
  return { width: args.width, lines };
}
