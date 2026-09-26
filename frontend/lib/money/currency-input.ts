/**
 * Pure helpers behind <CurrencyInput>: what the user may type, how it is displayed with
 * thousands separators, and where the caret goes after commas are inserted or removed.
 *
 * The *value* is always a plain decimal string without separators ("1250.5"), exactly what
 * the API and lib/money expect. Only the *display* has commas ("1,250.5").
 */

/** Characters a user may type or paste. Anything else (letters, symbols) is refused. */
const ALLOWED_CHARS = /^[\d.,\s₱]*$/;

export interface SanitizeOptions {
  /** Maximum digits after the decimal point (2 for prices, 4 for unit costs). */
  decimals?: number;
  /** Maximum digits before the decimal point (NUMERIC(14,2) allows 12). */
  maxIntegerDigits?: number;
}

/**
 * Turn raw input text into a plain decimal string, or `null` if the input must be refused
 * (letters, a second decimal point, too many decimals or digits).
 */
export function sanitizeCurrency(raw: string, { decimals = 2, maxIntegerDigits = 12 }: SanitizeOptions = {}): string | null {
  if (!ALLOWED_CHARS.test(raw)) return null;
  let s = raw.replace(/[,\s₱]/g, "");
  if (s === "") return "";
  if (!/^\d*(\.\d*)?$/.test(s)) return null; // more than one "."
  if (s.startsWith(".")) s = `0${s}`;
  const [intPart, fraction] = s.split(".") as [string, string | undefined];
  if (fraction !== undefined && (decimals === 0 || fraction.length > decimals)) return null;
  const integer = intPart.replace(/^0+(?=\d)/, ""); // "007" → "7", keep a single "0"
  if (integer.length > maxIntegerDigits) return null;
  return fraction === undefined ? integer : `${integer}.${fraction}`;
}

/** "1234567.5" → "1,234,567.5" (keeps a trailing "." while typing). */
export function formatCurrencyDisplay(value: string): string {
  if (!value) return "";
  const [intPart, fraction] = value.split(".") as [string, string | undefined];
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

/** Pad to at least `minDecimals` places on blur: "60" → "60.00", "20.6667" unchanged. */
export function padDecimals(value: string, minDecimals = 2): string {
  if (!value) return value;
  const [intPart, fraction = ""] = value.split(".");
  if (fraction.length >= minDecimals) return value;
  return `${intPart || "0"}.${fraction.padEnd(minDecimals, "0")}`;
}

/**
 * Caret position in `formatted` that corresponds to `caret` in `raw`: the caret stays after the
 * same number of digits / decimal point, whatever commas were added or removed around it.
 */
export function caretAfterFormat(raw: string, caret: number, formatted: string): number {
  const significant = raw.slice(0, caret).replace(/[^\d.]/g, "").replace(/^0+(?=\d)/, "").length;
  if (significant === 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (/[\d.]/.test(formatted[i] ?? "")) seen += 1;
    if (seen === significant) return i + 1;
  }
  return formatted.length;
}

/** Whether a single typed key may be inserted (used to refuse letters before they appear). */
export function isAllowedKey(key: string): boolean {
  return key.length !== 1 || /[\d.,]/.test(key);
}
