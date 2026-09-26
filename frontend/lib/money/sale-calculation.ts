/**
 * Sale arithmetic: discounts, order-discount allocation, tax, totals, payment settlement.
 *
 * A *contract* with the server (backend/app/modules/sales/calculation.py): both implementations
 * run `shared/test-vectors/sale_calculation.json`. Change the algorithm only together with the
 * Python code and the vectors. All amounts round HALF_UP to 2 decimals at each named step.
 *
 * Senior citizen / PWD lines (`statutory: true`, RA 9994 / RA 10754) remove VAT, then take 20%
 * off the VAT-exclusive price; they get no other line or order discount and are VAT-exempt.
 * Invariant per line: total = gross - lineDiscount - orderDiscountShare - vatExemption -
 * statutoryDiscount (+ taxAmount when prices exclude tax).
 */
import type { Big } from "big.js";

import { roundMoney, toBig, toMoneyString, type DecimalInput } from "./index";

export type DiscountKind = "PERCENT" | "AMOUNT";
export type TaxKind = "VATABLE" | "EXEMPT" | "ZERO_RATED";

export class CalculationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalculationError";
  }
}

export interface DiscountInput {
  kind: DiscountKind;
  value: DecimalInput;
}

export interface LineInput {
  quantity: DecimalInput;
  unitPrice: DecimalInput;
  /** Percent, e.g. "12". */
  taxRate: DecimalInput;
  taxKind?: TaxKind;
  discount?: DiscountInput | null;
  /** Senior citizen / PWD statutory discount applies to this line. */
  statutory?: boolean;
}

/** Money values as canonical 2-decimal strings. */
export interface LineResult {
  gross: string;
  lineDiscount: string;
  orderDiscountShare: string;
  net: string;
  taxAmount: string;
  total: string;
  vatExemption: string;
  statutoryDiscount: string;
}

export interface SaleTotals {
  grossTotal: string;
  lineDiscountTotal: string;
  orderDiscountTotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  vatableSales: string;
  vatAmount: string;
  exemptSales: string;
  zeroRatedSales: string;
  vatExemptionTotal: string;
  statutoryDiscountTotal: string;
}

/** Percent, RA 9994 (senior citizens) and RA 10754 (PWD). */
export const STATUTORY_RATE = "20";

export interface SaleCalculation {
  lines: LineResult[];
  totals: SaleTotals;
}

const ZERO = toBig("0");
const HUNDRED = toBig("100");

function sum(values: Big[]): Big {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

export function discountAmount(discount: DiscountInput, base: Big): Big {
  const value = toBig(discount.value);
  if (value.lt(ZERO)) throw new CalculationError("Discount cannot be negative");
  if (discount.kind === "PERCENT") {
    if (value.gt(HUNDRED)) throw new CalculationError("Percent discount cannot exceed 100");
    return roundMoney(base.times(value).div(HUNDRED));
  }
  const amount = roundMoney(value);
  if (amount.gt(base)) throw new CalculationError("Discount exceeds the amount it applies to");
  return amount;
}

/**
 * Split `amount` across lines proportionally to `bases`; shares sum exactly to `amount`. The
 * rounding remainder goes to the line with the largest base (first one on ties).
 */
export function allocate(amount: Big, bases: Big[]): Big[] {
  const totalBase = sum(bases);
  if (amount.eq(ZERO) || totalBase.eq(ZERO)) return bases.map(() => ZERO);
  const shares = bases.map((base) => roundMoney(amount.times(base).div(totalBase)));
  const remainder = amount.minus(sum(shares));
  if (!remainder.eq(ZERO)) {
    let largest = 0;
    bases.forEach((base, i) => {
      if (base.gt(bases[largest])) largest = i;
    });
    shares[largest] = shares[largest].plus(remainder);
  }
  return shares;
}

export function calculateSale(
  lines: LineInput[],
  options: { pricesIncludeTax: boolean; orderDiscount?: DiscountInput | null },
): SaleCalculation {
  if (lines.length === 0) throw new CalculationError("A sale needs at least one line");

  const gross: Big[] = [];
  const lineDiscounts: Big[] = [];
  for (const line of lines) {
    const quantity = toBig(line.quantity);
    const unitPrice = toBig(line.unitPrice);
    if (quantity.lte(ZERO)) throw new CalculationError("Quantity must be positive");
    if (unitPrice.lt(ZERO)) throw new CalculationError("Price cannot be negative");
    const g = roundMoney(unitPrice.times(quantity));
    gross.push(g);
    // Statutory lines take no other discount (the law forbids double discounts).
    lineDiscounts.push(line.discount && !line.statutory ? discountAmount(line.discount, g) : ZERO);
  }

  // Statutory lines are excluded from the order discount (base 0 -> share 0).
  const afterLine = gross.map((g, i) => (lines[i].statutory ? ZERO : g.minus(lineDiscounts[i])));
  const orderDiscountTotal = options.orderDiscount ? discountAmount(options.orderDiscount, sum(afterLine)) : ZERO;
  const shares = allocate(orderDiscountTotal, afterLine);

  let vatable = ZERO;
  let vat = ZERO;
  let exempt = ZERO;
  let zeroRated = ZERO;
  let vatExemptionTotal = ZERO;
  let statutoryTotal = ZERO;
  const results = lines.map((line, i) => {
    const rate = toBig(line.taxRate);
    if (line.statutory) {
      const r = statutoryLine(line, gross[i], options.pricesIncludeTax);
      exempt = exempt.plus(r.total);
      vatExemptionTotal = vatExemptionTotal.plus(r.vatExemption);
      statutoryTotal = statutoryTotal.plus(r.statutoryDiscount);
      return r;
    }
    const net = gross[i].minus(lineDiscounts[i]).minus(shares[i]);
    let tax: Big;
    let total: Big;
    if (options.pricesIncludeTax) {
      tax = roundMoney(net.times(rate).div(HUNDRED.plus(rate)));
      total = net;
    } else {
      tax = roundMoney(net.times(rate).div(HUNDRED));
      total = net.plus(tax);
    }
    const kind = line.taxKind ?? "VATABLE";
    if (kind === "EXEMPT") exempt = exempt.plus(total.minus(tax));
    else if (kind === "ZERO_RATED") zeroRated = zeroRated.plus(total.minus(tax));
    else {
      vatable = vatable.plus(total.minus(tax));
      vat = vat.plus(tax);
    }
    return { gross: gross[i], lineDiscount: lineDiscounts[i], share: shares[i], net, tax, total, vatExemption: ZERO, statutoryDiscount: ZERO };
  });

  const lineDiscountTotal = sum(lineDiscounts);
  return {
    lines: results.map((r) => ({
      gross: toMoneyString(r.gross),
      lineDiscount: toMoneyString(r.lineDiscount),
      orderDiscountShare: toMoneyString(r.share),
      net: toMoneyString(r.net),
      taxAmount: toMoneyString(r.tax),
      total: toMoneyString(r.total),
      vatExemption: toMoneyString(r.vatExemption),
      statutoryDiscount: toMoneyString(r.statutoryDiscount),
    })),
    totals: {
      grossTotal: toMoneyString(sum(gross)),
      lineDiscountTotal: toMoneyString(lineDiscountTotal),
      orderDiscountTotal: toMoneyString(orderDiscountTotal),
      discountTotal: toMoneyString(lineDiscountTotal.plus(orderDiscountTotal).plus(statutoryTotal)),
      taxTotal: toMoneyString(sum(results.map((r) => r.tax))),
      total: toMoneyString(sum(results.map((r) => r.total))),
      vatableSales: toMoneyString(vatable),
      vatAmount: toMoneyString(vat),
      exemptSales: toMoneyString(exempt),
      zeroRatedSales: toMoneyString(zeroRated),
      vatExemptionTotal: toMoneyString(vatExemptionTotal),
      statutoryDiscountTotal: toMoneyString(statutoryTotal),
    },
  };
}

interface LineCalc {
  gross: Big;
  lineDiscount: Big;
  share: Big;
  net: Big;
  tax: Big;
  total: Big;
  vatExemption: Big;
  statutoryDiscount: Big;
}

/** Senior citizen / PWD line: remove VAT, then 20% off the VAT-exclusive price (VAT-exempt). */
function statutoryLine(line: LineInput, gross: Big, pricesIncludeTax: boolean): LineCalc {
  const rate = toBig(line.taxRate);
  const kind = line.taxKind ?? "VATABLE";
  const base =
    kind === "VATABLE" && rate.gt(ZERO) && pricesIncludeTax ? roundMoney(gross.times(HUNDRED).div(HUNDRED.plus(rate))) : gross;
  const discount = roundMoney(base.times(toBig(STATUTORY_RATE)).div(HUNDRED));
  const net = base.minus(discount);
  return {
    gross,
    lineDiscount: ZERO,
    share: ZERO,
    net,
    tax: ZERO,
    total: net,
    vatExemption: gross.minus(base),
    statutoryDiscount: discount,
  };
}

export type PaymentKind = "CASH" | "EWALLET" | "CARD" | "BANK" | "OTHER";

export interface PaymentInput {
  methodKind: PaymentKind;
  /** Applied to the sale. */
  amount: DecimalInput;
  /** Cash handed over (>= amount). Only cash may exceed the applied amount. */
  tendered?: DecimalInput | null;
}

export interface PaymentSummary {
  paidTotal: string;
  changeTotal: string;
}

/** Validate split payments: applied amounts must equal the total; only cash gives change. */
export function settlePayments(total: DecimalInput, payments: PaymentInput[]): PaymentSummary {
  if (payments.length === 0) throw new CalculationError("At least one payment is required");
  let paid = ZERO;
  let change = ZERO;
  for (const p of payments) {
    const amount = toBig(p.amount);
    if (amount.lte(ZERO)) throw new CalculationError("Payment amounts must be positive");
    paid = paid.plus(roundMoney(amount));
    if (p.tendered !== undefined && p.tendered !== null) {
      const tendered = toBig(p.tendered);
      if (p.methodKind !== "CASH" && !tendered.eq(amount)) {
        throw new CalculationError("Only cash can be over-tendered");
      }
      if (tendered.lt(amount)) throw new CalculationError("Tendered amount is less than the applied amount");
      change = change.plus(roundMoney(tendered).minus(roundMoney(amount)));
    }
  }
  if (!paid.eq(toBig(total))) {
    throw new CalculationError(`Payments (${toMoneyString(paid)}) do not equal the sale total (${toMoneyString(total)})`);
  }
  return { paidTotal: toMoneyString(paid), changeTotal: toMoneyString(change) };
}
