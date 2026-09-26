import { describe, expect, it } from "vitest";

import {
  add,
  compare,
  formatMoney,
  InvalidDecimalError,
  isValidDecimal,
  multiply,
  percentOf,
  roundMoney,
  subtract,
  toBig,
  toMoneyString,
  toQuantityString,
} from "./index";

describe("toBig", () => {
  it("parses decimal strings exactly", () => {
    expect(toBig("0.1").plus(toBig("0.2")).toString()).toBe("0.3");
    expect(toBig(" 12.50 ").toString()).toBe("12.5");
    expect(toBig("-3").toString()).toBe("-3");
  });

  it("accepts safe integers but rejects fractional numbers", () => {
    expect(toBig(2).toString()).toBe("2");
    expect(() => toBig(0.1)).toThrow(InvalidDecimalError);
    expect(() => toBig(Number.MAX_SAFE_INTEGER + 2)).toThrow(InvalidDecimalError);
  });

  it("rejects malformed strings", () => {
    for (const bad of ["", "abc", "1e5", "1,000", "1.", ".5", "NaN"]) {
      expect(() => toBig(bad)).toThrow(InvalidDecimalError);
      expect(isValidDecimal(bad)).toBe(false);
    }
  });
});

describe("rounding", () => {
  it("rounds half up like Python ROUND_HALF_UP", () => {
    expect(toMoneyString("2.345")).toBe("2.35");
    expect(toMoneyString("2.344")).toBe("2.34");
    expect(toMoneyString("-2.345")).toBe("-2.35"); // half away from zero
    expect(toMoneyString("0.005")).toBe("0.01");
    expect(toMoneyString("1")).toBe("1.00");
  });

  it("does not suffer float errors", () => {
    // 1.005 as a JS float is 1.00499999..., which rounds down. As a decimal it rounds up.
    expect(toMoneyString("1.005")).toBe("1.01");
    expect(roundMoney("8.675").toFixed(2)).toBe("8.68");
  });

  it("formats quantities without trailing zeros", () => {
    expect(toQuantityString("2.000")).toBe("2");
    expect(toQuantityString("0.2505")).toBe("0.251");
  });
});

describe("arithmetic", () => {
  it("adds, subtracts and multiplies exactly", () => {
    expect(add("0.10", "0.20", "0.30").toString()).toBe("0.6");
    expect(add().toString()).toBe("0");
    expect(subtract("100", "99.99").toString()).toBe("0.01");
    expect(multiply("19.99", "3").toString()).toBe("59.97");
    expect(multiply("12.50", "0.333").toString()).toBe("4.1625");
  });

  it("computes percentages rounded to money scale", () => {
    expect(percentOf("199.99", "10").toFixed(2)).toBe("20.00");
    expect(percentOf("33.33", "12").toFixed(2)).toBe("4.00");
  });

  it("compares values", () => {
    expect(compare("1.10", "1.1")).toBe(0);
    expect(compare("2", "10")).toBe(-1);
  });
});

describe("formatMoney", () => {
  it("formats pesos with grouping and two decimals", () => {
    expect(formatMoney("1234.5")).toMatch(/1,234\.50/);
    expect(formatMoney("1234.5")).toContain("₱");
  });

  it("keeps precision for large values", () => {
    expect(formatMoney("12345678901234.56")).toMatch(/12,345,678,901,234\.56/);
  });
});
