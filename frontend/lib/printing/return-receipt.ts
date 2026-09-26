import type { DeviceBir } from "@/lib/db/meta";
import type { LocalBranch, LocalCompany, LocalRefund, LocalReturn, LocalReturnItem } from "@/lib/db/schema";
import { formatMoney, toMoneyString } from "@/lib/money";

import { birHeaderLines, type ReceiptDocument, type ReceiptLine, type ReceiptWidth } from "./receipt";

/** Return / refund slip, printed through the same pipeline as sales receipts. */
export function buildReturnReceipt(args: {
  ret: LocalReturn;
  items: LocalReturnItem[];
  refunds: LocalRefund[];
  originalReceipt: string;
  company: LocalCompany;
  branch: LocalBranch;
  terminalCode: string;
  width: ReceiptWidth;
  deviceBir?: DeviceBir | null;
}): ReceiptDocument {
  const { ret, company } = args;
  const lines: ReceiptLine[] = [
    ...birHeaderLines(company, args.branch, args.deviceBir),
    { kind: "center", text: "RETURN / REFUND", bold: true },
    { kind: "rule" },
    { kind: "pair", left: "Return", right: ret.returnNumber },
    { kind: "pair", left: "Original receipt", right: args.originalReceipt },
    { kind: "pair", left: "Date", right: new Date(ret.occurredAt).toLocaleString("en-PH") },
    { kind: "pair", left: "Terminal", right: args.terminalCode },
    { kind: "pair", left: "Cashier", right: ret.cashierName },
    { kind: "text", text: `Reason: ${ret.reason}` },
    { kind: "rule" },
  ];
  for (const item of args.items) {
    lines.push({ kind: "text", text: item.productName });
    lines.push({
      kind: "pair",
      left: `  ${item.quantity} ${item.unitCode}${item.restock ? "" : " (not restocked)"}`,
      right: `-${toMoneyString(item.refundAmount)}`,
    });
  }
  lines.push({ kind: "rule" });
  lines.push({ kind: "pair", left: "REFUND TOTAL", right: formatMoney(ret.refundTotal, company.currency), bold: true });
  for (const r of args.refunds) {
    lines.push({ kind: "pair", left: r.methodName, right: toMoneyString(r.amount) });
    if (r.referenceNo) lines.push({ kind: "pair", left: "  Ref", right: r.referenceNo });
  }
  lines.push({ kind: "rule" });
  lines.push({ kind: "center", text: "Customer signature: ________________" });
  lines.push({ kind: "barcode", value: ret.returnNumber });
  return { width: args.width, lines };
}
