import { describe, expect, it } from "vitest";

import type { Price, ProductUnit } from "@/types/api-admin";

import { fromPrices, parseCost, type PriceRow, toPriceIn } from "./price-rows";

const row = (over: Partial<PriceRow>): PriceRow => ({
  key: over.key ?? "k",
  unitId: "",
  levelId: "",
  branchId: "",
  minQuantity: "1",
  price: "25.00",
  ...over,
});

describe("toPriceIn", () => {
  it("maps blanks to null (base unit, default level, all branches)", () => {
    const { prices, errors } = toPriceIn([row({ key: "a" }), row({ key: "b", unitId: "u-box", minQuantity: "", price: "270" })]);
    expect(errors).toEqual({});
    expect(prices).toEqual([
      { price: "25.00", min_quantity: "1", unit_id: null, price_level_id: null, branch_id: null },
      { price: "270", min_quantity: "1", unit_id: "u-box", price_level_id: null, branch_id: null },
    ]);
  });

  it("rejects invalid amounts and quantities", () => {
    const { prices, errors } = toPriceIn([
      row({ key: "a", price: "25.505" }),
      row({ key: "b", price: "-1" }),
      row({ key: "c", minQuantity: "0" }),
    ]);
    expect(prices).toEqual([]);
    expect(Object.keys(errors)).toEqual(["a", "b", "c"]);
  });

  it("detects duplicates with equivalent quantities", () => {
    const { prices, errors } = toPriceIn([row({ key: "a", minQuantity: "12" }), row({ key: "b", minQuantity: "12.000" })]);
    expect(prices).toHaveLength(1);
    expect(errors.b).toMatch(/Duplicate/);
  });
});

describe("fromPrices", () => {
  const units: ProductUnit[] = [
    { id: "pu-pc", unit_id: "u-pc", unit_code: "PC", unit_name: "Piece", factor: "1.000000", is_base: true, is_active: true },
    { id: "pu-box", unit_id: "u-box", unit_code: "BOX", unit_name: "Box", factor: "12.000000", is_base: false, is_active: true },
  ];
  const price = (over: Partial<Price>): Price => ({
    id: "p",
    variant_id: "v",
    product_unit_id: "pu-pc",
    price_level_id: "retail",
    branch_id: null,
    min_quantity: "1.000",
    price: "25.00",
    is_active: true,
    ...over,
  });

  it("round-trips server prices, skipping inactive rows", () => {
    const rows = fromPrices(
      [
        price({ id: "1", min_quantity: "12.000", price: "23.5" }),
        price({ id: "2", product_unit_id: "pu-box", price: "270.00" }),
        price({ id: "3", is_active: false }),
        price({ id: "4", price_level_id: "wholesale", price: "22.00" }),
      ],
      units,
      "retail",
    );
    expect(rows.map((r) => [r.unitId, r.levelId, r.minQuantity, r.price])).toEqual([
      ["", "", "12", "23.50"],
      ["", "wholesale", "1", "22.00"],
      ["u-box", "", "1", "270.00"],
    ]);
    expect(toPriceIn(rows).prices).toHaveLength(3);
  });
});

describe("parseCost", () => {
  it("accepts up to 4 decimals", () => {
    expect(parseCost("")).toBeNull();
    expect(parseCost("18.5")).toBe("18.5");
    expect(parseCost("18.12345")).toBeUndefined();
    expect(parseCost("abc")).toBeUndefined();
  });
});
