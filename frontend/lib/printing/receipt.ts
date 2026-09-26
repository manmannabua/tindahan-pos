/**
 * Printer-independent receipt model + fixed-width text layout. See docs/RECEIPT_PRINTING.md.
 *
 * Both renderers (HTML/browser print now, ESC/POS later) consume the same laid-out lines, so a
 * 58 mm (32 columns) and an 80 mm (48 columns) receipt break lines identically everywhere.
 */
import type { LocalBranch, LocalCompany, LocalPayment, LocalSale, LocalSaleItem } from "@/lib/db/schema";
import { compare, formatMoney, toMoneyString } from "@/lib/money";

export type ReceiptWidth = 58 | 80;
export const COLUMNS: Record<ReceiptWidth, number> = { 58: 32, 80: 48 };

export type ReceiptLine =
  | { kind: "center"; text: string; bold?: boolean }
  | { kind: "text"; text: string }
  | { kind: "pair"; left: string; right: string; bold?: boolean }
  | { kind: "rule" }
  | { kind: "barcode"; value: string };

export interface ReceiptDocument {
  width: ReceiptWidth;
  lines: ReceiptLine[];
}

const money = (value: string) => toMoneyString(value);

export interface BuildReceiptArgs {
  sale: LocalSale;
  items: LocalSaleItem[];
  payments: LocalPayment[];
  company: LocalCompany;
  branch: LocalBranch;
  terminalCode: string;
  width: ReceiptWidth;
  isReprint?: boolean;
}

export function buildReceipt(args: BuildReceiptArgs): ReceiptDocument {
  const { sale, items, payments, company, branch } = args;
  const lines: ReceiptLine[] = [];
  lines.push({ kind: "center", text: company.legalName ?? company.name, bold: true });
  if (company.legalName && company.legalName !== company.name) lines.push({ kind: "center", text: company.name });
  lines.push({ kind: "center", text: branch.name });
  if (branch.address) lines.push({ kind: "center", text: branch.address });
  const tin = branch.tin ?? company.tin;
  if (tin) lines.push({ kind: "center", text: `TIN ${tin}` });
  for (const header of (branch.receiptHeader ?? "").split("\n").filter(Boolean)) {
    lines.push({ kind: "center", text: header });
  }
  if (args.isReprint) lines.push({ kind: "center", text: "*** REPRINT ***", bold: true });
  if (sale.status === "VOIDED") lines.push({ kind: "center", text: "*** VOIDED ***", bold: true });
  lines.push({ kind: "rule" });
  lines.push({ kind: "pair", left: "Receipt", right: sale.receiptNumber });
  lines.push({ kind: "pair", left: "Date", right: new Date(sale.occurredAt).toLocaleString("en-PH") });
  lines.push({ kind: "pair", left: "Terminal", right: args.terminalCode });
  lines.push({ kind: "pair", left: "Cashier", right: sale.cashierName });
  lines.push({ kind: "rule" });

  for (const item of [...items].sort((a, b) => a.lineNo - b.lineNo)) {
    const name = item.variantName ? `${item.productName} ${item.variantName}` : item.productName;
    lines.push({ kind: "text", text: name });
    lines.push({
      kind: "pair",
      left: `  ${item.quantity} ${item.unitCode} x ${money(item.unitPrice)}`,
      right: money(item.gross),
    });
    if (compare(item.lineDiscount, "0") > 0) {
      lines.push({ kind: "pair", left: "  Discount", right: `-${money(item.lineDiscount)}` });
    }
  }
  lines.push({ kind: "rule" });
  lines.push({ kind: "pair", left: "Subtotal", right: money(sale.grossTotal) });
  if (compare(sale.discountTotal, "0") > 0) lines.push({ kind: "pair", left: "Discount", right: `-${money(sale.discountTotal)}` });
  if (!sale.pricesIncludeTax) lines.push({ kind: "pair", left: "VAT", right: money(sale.taxTotal) });
  lines.push({ kind: "pair", left: "TOTAL", right: formatMoney(sale.total, company.currency), bold: true });
  lines.push({ kind: "rule" });
  for (const p of payments) {
    lines.push({ kind: "pair", left: p.methodName, right: money(p.tendered ?? p.amount) });
    if (p.referenceNo) lines.push({ kind: "pair", left: "  Ref", right: p.referenceNo });
  }
  lines.push({ kind: "pair", left: "Change", right: money(sale.changeTotal), bold: true });
  lines.push({ kind: "rule" });
  lines.push({ kind: "pair", left: "VATable sales", right: money(sale.vatableSales) });
  lines.push({ kind: "pair", left: "VAT amount", right: money(sale.vatAmount) });
  lines.push({ kind: "pair", left: "VAT-exempt sales", right: money(sale.exemptSales) });
  lines.push({ kind: "pair", left: "Zero-rated sales", right: money(sale.zeroRatedSales) });
  lines.push({ kind: "rule" });
  for (const footer of (branch.receiptFooter ?? "Thank you!").split("\n").filter(Boolean)) {
    lines.push({ kind: "center", text: footer });
  }
  lines.push({ kind: "barcode", value: sale.receiptNumber });
  return { width: args.width, lines };
}

/** Word-wrap to `cols`; words longer than a line are hard-split. */
export function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    let w = word;
    while (w.length > cols) {
      if (current) {
        out.push(current);
        current = "";
      }
      out.push(w.slice(0, cols));
      w = w.slice(cols);
    }
    if (!current) current = w;
    else if (current.length + 1 + w.length <= cols) current += ` ${w}`;
    else {
      out.push(current);
      current = w;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [""];
}

/** Lay out a receipt as fixed-width text rows (each at most `cols` characters). */
export function layoutReceipt(doc: ReceiptDocument): { text: string; bold: boolean; barcode?: string }[] {
  const cols = COLUMNS[doc.width];
  const rows: { text: string; bold: boolean; barcode?: string }[] = [];
  for (const line of doc.lines) {
    switch (line.kind) {
      case "rule":
        rows.push({ text: "-".repeat(cols), bold: false });
        break;
      case "text":
        for (const t of wrap(line.text, cols)) rows.push({ text: t, bold: false });
        break;
      case "center":
        for (const t of wrap(line.text, cols)) {
          const pad = Math.floor((cols - t.length) / 2);
          rows.push({ text: " ".repeat(pad) + t, bold: Boolean(line.bold) });
        }
        break;
      case "pair": {
        const right = line.right.slice(0, cols);
        const room = cols - right.length - 1;
        const left = wrap(line.left, Math.max(1, room));
        left.slice(0, -1).forEach((t) => rows.push({ text: t, bold: Boolean(line.bold) }));
        const last = left.at(-1) ?? "";
        rows.push({ text: last + " ".repeat(Math.max(1, cols - last.length - right.length)) + right, bold: Boolean(line.bold) });
        break;
      }
      case "barcode":
        rows.push({ text: "", bold: false, barcode: line.value });
        break;
    }
  }
  return rows;
}
