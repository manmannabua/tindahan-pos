import { describe, expect, it } from "vitest";

import { caretAfterFormat, formatCurrencyDisplay, isAllowedKey, padDecimals, sanitizeCurrency } from "./currency-input";

describe("sanitizeCurrency", () => {
  it("strips separators and the peso sign", () => {
    expect(sanitizeCurrency("₱1,250.50")).toBe("1250.50");
    expect(sanitizeCurrency(" 1 000 ")).toBe("1000");
  });

  it("refuses letters and symbols", () => {
    expect(sanitizeCurrency("12a")).toBeNull();
    expect(sanitizeCurrency("abc")).toBeNull();
    expect(sanitizeCurrency("-5")).toBeNull();
    expect(sanitizeCurrency("1e3")).toBeNull();
    expect(sanitizeCurrency("$10")).toBeNull();
  });

  it("allows one decimal point and limits decimals", () => {
    expect(sanitizeCurrency("1.2.3")).toBeNull();
    expect(sanitizeCurrency("1.234")).toBeNull();
    expect(sanitizeCurrency("1.2345", { decimals: 4 })).toBe("1.2345");
    expect(sanitizeCurrency("5.", {})).toBe("5.");
    expect(sanitizeCurrency(".5")).toBe("0.5");
    expect(sanitizeCurrency("1.5", { decimals: 0 })).toBeNull();
  });

  it("drops leading zeros and limits integer digits", () => {
    expect(sanitizeCurrency("007")).toBe("7");
    expect(sanitizeCurrency("0.75")).toBe("0.75");
    expect(sanitizeCurrency("0")).toBe("0");
    expect(sanitizeCurrency("1234567890123")).toBeNull(); // 13 digits
    expect(sanitizeCurrency("")).toBe("");
  });
});

describe("formatCurrencyDisplay", () => {
  it("groups thousands and keeps the fraction as typed", () => {
    expect(formatCurrencyDisplay("1234567.5")).toBe("1,234,567.5");
    expect(formatCurrencyDisplay("999")).toBe("999");
    expect(formatCurrencyDisplay("1000")).toBe("1,000");
    expect(formatCurrencyDisplay("1250.")).toBe("1,250.");
    expect(formatCurrencyDisplay("")).toBe("");
  });
});

describe("padDecimals", () => {
  it("pads to two decimals on blur but keeps longer costs", () => {
    expect(padDecimals("60")).toBe("60.00");
    expect(padDecimals("60.5")).toBe("60.50");
    expect(padDecimals("20.6667")).toBe("20.6667");
    expect(padDecimals("")).toBe("");
  });
});

describe("caretAfterFormat", () => {
  it("keeps the caret after the same digit when a comma appears", () => {
    // typed the 4th digit at the end: "1234" → "1,234"
    expect(caretAfterFormat("1234", 4, "1,234")).toBe(5);
    // inserted "9" after "1" in "1,234" → raw "19,234" (caret 2) → "19,234" caret 2
    expect(caretAfterFormat("19,234", 2, "19,234")).toBe(2);
    // deleting a digit removes a comma: "1,23|4" → "1,2|4"? raw "1,24" caret 3 → "124" caret 2
    expect(caretAfterFormat("1,24", 3, "124")).toBe(2);
    expect(caretAfterFormat("", 0, "")).toBe(0);
  });
});

describe("isAllowedKey", () => {
  it("lets digits, separators and control keys through, not letters", () => {
    expect(isAllowedKey("5")).toBe(true);
    expect(isAllowedKey(".")).toBe(true);
    expect(isAllowedKey("Backspace")).toBe(true);
    expect(isAllowedKey("ArrowLeft")).toBe(true);
    expect(isAllowedKey("a")).toBe(false);
    expect(isAllowedKey("-")).toBe(false);
    expect(isAllowedKey(" ")).toBe(false);
  });
});
