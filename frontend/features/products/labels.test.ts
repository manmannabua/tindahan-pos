import { describe, expect, it } from "vitest";

import { expandLabels, fitName, LABEL_SIZES, labelFormat, pageCss, paginate } from "./labels";

describe("labelFormat", () => {
  it("uses EAN/UPC only for valid GTINs", () => {
    expect(labelFormat("4800361419116")).toBe("EAN13");
    expect(labelFormat("4800361419117")).toBe("CODE128"); // invalid check digit
    expect(labelFormat("036000291452")).toBe("UPC");
    expect(labelFormat("96385074")).toBe("EAN8");
    expect(labelFormat("ITEM-42a")).toBe("CODE128");
    expect(labelFormat("2000000000428")).toBe("EAN13"); // internal restricted-circulation code
  });
});

describe("expandLabels", () => {
  it("expands copies and skips items without a code", () => {
    const labels = expandLabels([
      { key: "a", name: "Cola", code: "4800361419116", price: "₱25.00", copies: 3 },
      { key: "b", name: "No code", code: "", price: null, copies: 5 },
      { key: "c", name: "Chips", code: "CHIPS-1", price: null, copies: 0 },
    ]);
    expect(labels.map((l) => l.key)).toEqual(["a-0", "a-1", "a-2"]);
    expect(labels[0].format).toBe("EAN13");
  });

  it("caps copies per item", () => {
    expect(expandLabels([{ key: "a", name: "X", code: "X1", price: null, copies: 10_000 }])).toHaveLength(500);
  });
});

describe("paginate / pageCss", () => {
  const roll = LABEL_SIZES.find((s) => s.id === "38x25")!;
  const a4 = LABEL_SIZES.find((s) => s.id === "a4-3x8")!;

  it("puts one label per page on rolls and 24 per A4 sheet", () => {
    const labels = Array.from({ length: 30 }, (_, i) => i);
    expect(paginate(labels, roll)).toHaveLength(30);
    expect(paginate(labels, a4).map((p) => p.length)).toEqual([24, 6]);
  });

  it("sizes the printed page", () => {
    expect(pageCss(roll)).toBe("@page { size: 38mm 25mm; margin: 0mm; }");
    expect(pageCss(a4)).toBe("@page { size: 210mm 297mm; margin: 0mm; }");
  });
});

describe("fitName", () => {
  it("truncates long names for narrow labels", () => {
    expect(fitName("Short", 38)).toBe("Short");
    expect(fitName("A very long product name that will not fit", 38)).toHaveLength(34);
  });
});
