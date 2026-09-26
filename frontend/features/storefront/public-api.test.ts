import { describe, expect, it } from "vitest";

import { priceText, quantityText } from "./components/public-product";
import { catalogSearch, emptyQuery, parseCatalogQuery, productPath, productsPath, timeAgo } from "./public-api";

const CAT = "0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

describe("parseCatalogQuery", () => {
  it("reads the page URL's search params", () => {
    expect(parseCatalogQuery({ q: "coke", category: CAT, stock: "1", page: "3" })).toEqual({
      q: "coke",
      category: CAT,
      branch: null,
      inStock: true,
      page: 3,
    });
  });

  it("drops invalid values instead of sending them to the API", () => {
    expect(parseCatalogQuery({ category: "drinks", branch: "1 OR 1=1", page: "-4", stock: "yes" })).toEqual(emptyQuery);
    expect(parseCatalogQuery({ page: "9999" }).page).toBe(1);
    expect(parseCatalogQuery({ q: "x".repeat(200) }).q).toHaveLength(60);
    expect(parseCatalogQuery({ q: ["first", "second"] }).q).toBe("first");
  });

  it("round-trips through catalogSearch", () => {
    const query = { q: "pancit canton", category: CAT, branch: null, inStock: true, page: 2 };
    const search = catalogSearch(query);
    expect(search).toBe(`?q=pancit+canton&category=${CAT}&stock=1&page=2`);
    expect(parseCatalogQuery(Object.fromEntries(new URLSearchParams(search)))).toEqual(query);
    expect(catalogSearch(emptyQuery)).toBe("");
  });
});

describe("API paths", () => {
  it("maps the query to the public products endpoint", () => {
    expect(productsPath("my-store", { ...emptyQuery, q: " 100% ", inStock: true, page: 2 })).toBe(
      "/api/v1/public/stores/my-store/products?limit=24&offset=24&q=100%25&in_stock=true",
    );
    expect(productPath("my-store", "p1", CAT)).toBe(`/api/v1/public/stores/my-store/products/p1?branch_id=${CAT}`);
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  it.each([
    ["2026-09-26T11:59:40Z", "just now"],
    ["2026-09-26T11:55:00Z", "5 min ago"],
    ["2026-09-26T09:00:00Z", "3 h ago"],
    ["2026-09-25T11:00:00Z", "1 day ago"],
    ["2026-09-20T12:00:00Z", "6 days ago"],
  ])("%s → %s", (iso, expected) => {
    expect(timeAgo(iso, now)).toBe(expected);
  });
});

describe("priceText", () => {
  it("uses the unit symbol for measured goods, the name for other units, nothing for pieces", () => {
    expect(priceText("75.00", { unit: "Piece", unit_symbol: null }, false)).toBe("₱75.00");
    expect(priceText("52.00", { unit: "Kilogram", unit_symbol: "kg" }, false)).toBe("₱52.00 / kg");
    expect(priceText("180.00", { unit: "Box", unit_symbol: null }, false)).toBe("₱180.00 / box");
    expect(priceText("75.00", { unit: "Piece", unit_symbol: null }, true)).toBe("from ₱75.00");
  });
});

describe("quantityText", () => {
  it("adds the unit for measured goods only", () => {
    expect(quantityText("100.000", "kg")).toBe("100 kg left");
    expect(quantityText("2.500", "kg")).toBe("2.5 kg left");
    expect(quantityText("12.000", null)).toBe("12 left");
  });
});
