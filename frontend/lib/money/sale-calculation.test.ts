import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CalculationError,
  calculateSale,
  settlePayments,
  type DiscountInput,
  type PaymentKind,
  type TaxKind,
} from "./sale-calculation";

// The same file is executed by pytest (backend/tests/unit/test_sale_calculation.py).
const VECTORS_PATH = resolve(__dirname, "../../../shared/test-vectors/sale_calculation.json");

interface RawDiscount {
  kind: "PERCENT" | "AMOUNT";
  value: string;
}
interface SaleCase {
  name: string;
  prices_include_tax: boolean;
  order_discount?: RawDiscount;
  lines: { quantity: string; unit_price: string; tax_rate: string; tax_kind?: TaxKind; discount?: RawDiscount }[];
  expected: { lines: Record<string, string>[]; totals: Record<string, string> };
}
interface PaymentCase {
  name: string;
  total: string;
  payments: { method_kind: PaymentKind; amount: string; tendered?: string }[];
  error?: boolean;
  expected?: { paid_total: string; change_total: string };
}
const vectors = JSON.parse(readFileSync(VECTORS_PATH, "utf-8")) as { sales: SaleCase[]; payments: PaymentCase[] };

const toCamel = (s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const discount = (d?: RawDiscount): DiscountInput | null => (d ? { kind: d.kind, value: d.value } : null);

describe("shared sale calculation vectors", () => {
  it("has cases", () => {
    expect(vectors.sales.length).toBeGreaterThan(5);
  });

  for (const c of vectors.sales) {
    it(c.name, () => {
      const result = calculateSale(
        c.lines.map((l) => ({
          quantity: l.quantity,
          unitPrice: l.unit_price,
          taxRate: l.tax_rate,
          taxKind: l.tax_kind ?? "VATABLE",
          discount: discount(l.discount),
        })),
        { pricesIncludeTax: c.prices_include_tax, orderDiscount: discount(c.order_discount) },
      );
      c.expected.lines.forEach((want, i) => {
        for (const [key, value] of Object.entries(want)) {
          expect(result.lines[i][toCamel(key) as keyof (typeof result.lines)[number]], `${key}`).toBe(value);
        }
      });
      for (const [key, value] of Object.entries(c.expected.totals)) {
        expect(result.totals[toCamel(key) as keyof typeof result.totals], key).toBe(value);
      }
    });
  }

  for (const c of vectors.payments) {
    it(`payments: ${c.name}`, () => {
      const payments = c.payments.map((p) => ({ methodKind: p.method_kind, amount: p.amount, tendered: p.tendered }));
      if (c.error) {
        expect(() => settlePayments(c.total, payments)).toThrow(CalculationError);
      } else {
        expect(settlePayments(c.total, payments)).toEqual({
          paidTotal: c.expected?.paid_total,
          changeTotal: c.expected?.change_total,
        });
      }
    });
  }
});

describe("calculateSale", () => {
  it("rejects discounts larger than the line", () => {
    expect(() =>
      calculateSale([{ quantity: "1", unitPrice: "10.00", taxRate: "12", discount: { kind: "AMOUNT", value: "11" } }], {
        pricesIncludeTax: true,
      }),
    ).toThrow(CalculationError);
  });
});
