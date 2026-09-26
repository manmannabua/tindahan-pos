/**
 * Money and quantity arithmetic.
 *
 * Money travels as decimal strings ("123.45") in JSON and in IndexedDB, and all arithmetic uses
 * big.js — mirroring Python `Decimal` with ROUND_HALF_UP on the server. JS numbers are never used
 * for money: 0.1 + 0.2 !== 0.3.
 *
 * See docs/ARCHITECTURE.md §5 for the sale calculation rules these helpers support.
 */
import BigConstructor, { type Big } from "big.js";

/** A dedicated Big constructor so global big.js settings elsewhere can't change our rounding. */
const D = BigConstructor();
D.RM = 1; // ROUND_HALF_UP (Big.roundHalfUp)
D.DP = 20;
D.strict = true; // refuse JS numbers that aren't exactly representable (see toBig)

export type Decimal = Big;
/** Accepted inputs: decimal strings, Big values, or integer numbers (e.g. quantity 2). */
export type DecimalInput = string | Big | number;

export const MONEY_SCALE = 2;
export const QUANTITY_SCALE = 3;
const HALF_UP = 1;

const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export class InvalidDecimalError extends Error {
  constructor(value: unknown) {
    super(`Invalid decimal value: ${String(value)}`);
    this.name = "InvalidDecimalError";
  }
}

export function toBig(value: DecimalInput): Big {
  if (value instanceof D || (typeof value === "object" && value !== null && "c" in value)) {
    return new D(value);
  }
  if (typeof value === "number") {
    // Only safe integers: a fractional JS number has already lost precision.
    if (!Number.isSafeInteger(value)) throw new InvalidDecimalError(value);
    return new D(String(value));
  }
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) throw new InvalidDecimalError(value);
  return new D(trimmed);
}

export function isValidDecimal(value: string): boolean {
  return DECIMAL_PATTERN.test(value.trim());
}

export function roundMoney(value: DecimalInput): Big {
  return toBig(value).round(MONEY_SCALE, HALF_UP);
}

export function roundQuantity(value: DecimalInput): Big {
  return toBig(value).round(QUANTITY_SCALE, HALF_UP);
}

/** Canonical money string with exactly two decimals, e.g. "1250.50". */
export function toMoneyString(value: DecimalInput): string {
  return roundMoney(value).toFixed(MONEY_SCALE);
}

/** Canonical quantity string with up to three decimals, trailing zeros removed ("2", "0.25"). */
export function toQuantityString(value: DecimalInput): string {
  return roundQuantity(value).toString();
}

export function add(...values: DecimalInput[]): Big {
  return values.reduce<Big>((sum, v) => sum.plus(toBig(v)), new D("0"));
}

export function subtract(a: DecimalInput, b: DecimalInput): Big {
  return toBig(a).minus(toBig(b));
}

/** Exact product (no rounding). Round explicitly at the step the calculation rules require. */
export function multiply(a: DecimalInput, b: DecimalInput): Big {
  return toBig(a).times(toBig(b));
}

/** `round(amount × percent / 100)` to money scale. */
export function percentOf(amount: DecimalInput, percent: DecimalInput): Big {
  return roundMoney(toBig(amount).times(toBig(percent)).div("100"));
}

export function compare(a: DecimalInput, b: DecimalInput): -1 | 0 | 1 {
  return toBig(a).cmp(toBig(b)) as -1 | 0 | 1;
}

export function isZero(value: DecimalInput): boolean {
  return toBig(value).eq("0");
}

export function isNegative(value: DecimalInput): boolean {
  return toBig(value).lt("0");
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Display formatting, e.g. "₱1,250.50". Uses the string form so no float conversion happens. */
export function formatMoney(value: DecimalInput, currency = "PHP", locale = "en-PH"): string {
  const key = `${locale}|${currency}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: MONEY_SCALE,
      maximumFractionDigits: MONEY_SCALE,
    });
    formatters.set(key, formatter);
  }
  return formatter.format(toMoneyString(value) as Intl.StringNumericLiteral);
}
