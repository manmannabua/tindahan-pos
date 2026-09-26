import { formatMoney, isValidDecimal, toBig } from "@/lib/money";

/** Money for display; "—" for missing values. Decimal strings only, never floats. */
export function money(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "" || !isValidDecimal(value)) return "—";
  return formatMoney(value);
}

/** Quantity without trailing zeros ("24", "0.25", "-2"). */
export function qty(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "" || !isValidDecimal(value)) return "—";
  return toBig(value).toString();
}

/** A local calendar date as YYYY-MM-DD (for report and filter inputs). */
export function isoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function daysAgo(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return isoDate(d);
}

export function humanize(code: string): string {
  const s = code.replaceAll("_", " ").replaceAll("-", " ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
