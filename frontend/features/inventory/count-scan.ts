/**
 * Scan-to-count state. Each scan is sent to the server (POST /inventory/counts/{id}/lines, ADD
 * mode); the server's returned line is the truth for that item, so out-of-order responses and
 * retries can't double-count on screen.
 */
import { toBig } from "@/lib/money";
import type { StockCountLine } from "@/types/api-admin";

export interface CountRow {
  variantId: string;
  counted: string;
  system: string;
  countedAt: string;
}

export interface ScanEntry {
  id: string;
  code: string;
  status: "pending" | "ok" | "error";
  message?: string;
  variantId?: string;
}

export interface CountScanState {
  rows: Record<string, CountRow>;
  log: ScanEntry[];
}

export type CountScanAction =
  | { type: "loaded"; lines: StockCountLine[] }
  | { type: "scan-started"; id: string; code: string }
  | { type: "scan-ok"; id: string; line: StockCountLine }
  | { type: "scan-failed"; id: string; message: string };

export const initialCountScan: CountScanState = { rows: {}, log: [] };
const LOG_SIZE = 25;

function toRow(line: StockCountLine): CountRow {
  return { variantId: line.variant_id, counted: line.counted_quantity, system: line.system_quantity, countedAt: line.counted_at };
}

export function countScanReducer(state: CountScanState, action: CountScanAction): CountScanState {
  switch (action.type) {
    case "loaded":
      return { ...state, rows: Object.fromEntries(action.lines.map((l) => [l.variant_id, toRow(l)])) };
    case "scan-started":
      return { ...state, log: [{ id: action.id, code: action.code, status: "pending" as const }, ...state.log].slice(0, LOG_SIZE) };
    case "scan-ok": {
      const current = state.rows[action.line.variant_id];
      // Keep whichever server state is newer (responses may arrive out of order).
      const newer = !current || current.countedAt <= action.line.counted_at;
      return {
        rows: newer ? { ...state.rows, [action.line.variant_id]: toRow(action.line) } : state.rows,
        log: state.log.map((e) => (e.id === action.id ? { ...e, status: "ok" as const, variantId: action.line.variant_id } : e)),
      };
    }
    case "scan-failed":
      return { ...state, log: state.log.map((e) => (e.id === action.id ? { ...e, status: "error" as const, message: action.message } : e)) };
  }
}

export interface VarianceSummary {
  lines: number;
  over: number;
  short: number;
  exact: number;
}

export function variance(row: CountRow): string {
  return toBig(row.counted).minus(toBig(row.system)).toString();
}

export function summarize(rows: CountRow[]): VarianceSummary {
  const summary = { lines: rows.length, over: 0, short: 0, exact: 0 };
  for (const row of rows) {
    const diff = toBig(row.counted).cmp(toBig(row.system));
    if (diff > 0) summary.over += 1;
    else if (diff < 0) summary.short += 1;
    else summary.exact += 1;
  }
  return summary;
}
