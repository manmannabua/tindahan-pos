/**
 * Turns generic report data (`ReportResult.data`: an object of metrics or a list of rows) into
 * something renderable: KPI cards or a table with typed, formatted columns. Pure and tested.
 */
import { formatMoney, isValidDecimal, toBig } from "@/lib/money";

export type CellKind = "money" | "quantity" | "percent" | "integer" | "datetime" | "date" | "id" | "text";

/** Column names that hold money (decimal strings with 2 places in the API). */
const MONEY = /(^|_)(sales|total|amount|discounts?|tax|returns|refund_total|voids_amount|revenue_ex_tax|cogs|gross_profit|value|average_ticket|opening_float|expected_cash|server_expected_cash|counted_cash|over_short|total_cost|stock_value|variance_value|gross_sales|net_sales|refunds|gross|net|vat_exemptions?|grand_total)$/;
const QUANTITY = /(^|_)(quantity|units|on_hand|net_quantity|quantity_sold|absolute_variance_units|reorder_point)$/;
const PERCENT = /_pct$/;
const DATETIME = /(_at|^period)$/;

export function cellKind(column: string, sample: unknown): CellKind {
  if (column.endsWith("_id")) return "id";
  if (PERCENT.test(column)) return "percent";
  if (DATETIME.test(column)) return "datetime";
  if (MONEY.test(column)) return "money";
  if (QUANTITY.test(column)) return "quantity";
  if (typeof sample === "number") return "integer";
  return "text";
}

export function formatCell(value: unknown, kind: CellKind): string {
  if (value === null || value === undefined || value === "") return "—";
  const s = String(value);
  switch (kind) {
    case "money":
      return isValidDecimal(s) ? formatMoney(s) : s;
    case "quantity":
      return isValidDecimal(s) ? toBig(s).toString() : s;
    case "percent":
      return isValidDecimal(s) ? `${toBig(s).toFixed(2)}%` : s;
    case "integer":
      return typeof value === "number" ? value.toLocaleString("en-PH") : s;
    case "datetime": {
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? s : d.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: s.length > 10 && !s.endsWith("T00:00:00") ? "short" : undefined });
    }
    default:
      return s;
  }
}

export function humanLabel(column: string): string {
  const s = column.replace(/_pct$/, "_%").replaceAll("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export interface Column {
  key: string;
  label: string;
  kind: CellKind;
  numeric: boolean;
}

export type Presentation =
  | {
      type: "kpis";
      items: { key: string; label: string; value: string; kind: CellKind }[];
      /** Lists inside a summary (e.g. payments by method in a terminal reading), shown as tables. */
      nested: { key: string; label: string; presentation: Presentation }[];
    }
  | { type: "table"; columns: Column[]; rows: Record<string, unknown>[] }
  | { type: "empty" };

export function present(data: unknown): Presentation {
  if (Array.isArray(data)) {
    if (data.length === 0) return { type: "empty" };
    const rows = data.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
    const keys = Object.keys(rows[0] ?? {});
    const columns = keys
      .map((key) => {
        const kind = cellKind(key, rows.find((r) => r[key] !== null)?.[key]);
        return { key, label: humanLabel(key), kind, numeric: ["money", "quantity", "percent", "integer"].includes(kind) };
      })
      // Ids are for linking, not reading.
      .filter((c) => c.kind !== "id");
    return { type: "table", columns, rows };
  }
  if (data && typeof data === "object") {
    const entries = Object.entries(data as Record<string, unknown>);
    const items = entries
      .filter(([, value]) => !isNested(value))
      .map(([key, value]) => {
        const kind = cellKind(key, value);
        return { key, label: humanLabel(key), value: formatCell(value, kind), kind };
      })
      .filter((item) => item.kind !== "id");
    const nested = entries
      .filter(([, value]) => isNested(value))
      .map(([key, value]) => ({ key, label: humanLabel(key), presentation: present(value) }));
    return items.length || nested.length ? { type: "kpis", items, nested } : { type: "empty" };
  }
  return { type: "empty" };
}

function isNested(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}

/** Chart series for time/hour reports: [{x, y}] with y as a JS number (display only, never math). */
export function chartPoints(rows: Record<string, unknown>[], x: string, y: string): { x: string; y: number }[] {
  return rows.map((r) => {
    const raw = r[x];
    const label = x === "hour" ? `${String(raw).padStart(2, "0")}:00` : typeof raw === "string" ? raw.slice(0, 10) : String(raw);
    const value = r[y];
    return { x: label, y: typeof value === "number" ? value : Number(value ?? 0) };
  });
}
