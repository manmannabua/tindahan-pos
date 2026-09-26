import { describe, expect, it } from "vitest";

import { type PriceCandidate, resolvePrice } from "./resolve-price";

// Same cases as backend/tests/unit/test_price_resolver.py.
const c = (unit: string, level: string, price: string, minQuantity = "1", branchId: string | null = null): PriceCandidate => ({
  productUnitId: unit,
  priceLevelId: level,
  branchId,
  minQuantity,
  price,
});

const CANDIDATES = [
  c("PC", "RETAIL", "25.00"),
  c("PC", "RETAIL", "23.50", "12"),
  c("PC", "RETAIL", "24.00", "1", "A"),
  c("BOX", "RETAIL", "270.00"),
  c("PC", "WHOLESALE", "22.00"),
];

function resolve(unit = "PC", level = "RETAIL", branch: string | null = "B", quantity = "1") {
  return resolvePrice(CANDIDATES, {
    productUnitId: unit,
    priceLevelId: level,
    defaultPriceLevelId: "RETAIL",
    branchId: branch,
    quantity,
  })?.price;
}

describe("resolvePrice", () => {
  it("base price", () => expect(resolve()).toBe("25.00"));
  it("quantity break", () => {
    expect(resolve("PC", "RETAIL", "B", "11")).toBe("25.00");
    expect(resolve("PC", "RETAIL", "B", "12")).toBe("23.50");
  });
  it("branch override beats company price and breaks", () => {
    expect(resolve("PC", "RETAIL", "A")).toBe("24.00");
    expect(resolve("PC", "RETAIL", "A", "20")).toBe("24.00");
  });
  it("unit specific", () => expect(resolve("BOX")).toBe("270.00"));
  it("falls back to the default level", () => {
    expect(resolve("PC", "WHOLESALE")).toBe("22.00");
    expect(resolve("BOX", "WHOLESALE")).toBe("270.00");
  });
  it("no price for unit", () => expect(resolve("CASE")).toBeUndefined());
});
