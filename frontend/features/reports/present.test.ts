import { describe, expect, it } from "vitest";

import { cellKind, chartPoints, formatCell, present } from "./present";

describe("cellKind / formatCell", () => {
  it("recognises money, quantities, percents, ids and dates by column name", () => {
    expect(cellKind("gross_profit", "17.29")).toBe("money");
    expect(cellKind("sales", "117.17")).toBe("money");
    expect(cellKind("quantity_sold", "2.000")).toBe("quantity");
    expect(cellKind("gross_margin_pct", "21.01")).toBe("percent");
    expect(cellKind("variant_id", "x")).toBe("id");
    expect(cellKind("completed_at", "2026-09-26T03:00:00Z")).toBe("datetime");
    expect(cellKind("transactions", 2)).toBe("integer");
    expect(cellKind("product_name", "Cola")).toBe("text");
  });

  it("formats without floats and shows a dash for missing values", () => {
    expect(formatCell("1234.5", "money")).toBe("₱1,234.50");
    expect(formatCell("24.000", "quantity")).toBe("24");
    expect(formatCell("21.01", "percent")).toBe("21.01%");
    expect(formatCell(null, "money")).toBe("—");
    expect(formatCell(12345, "integer")).toBe("12,345");
  });
});

describe("present", () => {
  it("renders a summary object as KPIs", () => {
    const p = present({ transactions: 2, sales: "117.17", gross_margin_pct: null });
    expect(p.type).toBe("kpis");
    if (p.type !== "kpis") return;
    expect(p.items.map((i) => [i.label, i.value])).toEqual([
      ["Transactions", "2"],
      ["Sales", "₱117.17"],
      ["Gross margin %", "—"],
    ]);
  });

  it("renders a list as a table without id columns", () => {
    const p = present([{ variant_id: "v", product_name: "Cola", quantity: "3.000", sales: "75.00" }]);
    expect(p.type).toBe("table");
    if (p.type !== "table") return;
    expect(p.columns.map((c) => [c.key, c.kind, c.numeric])).toEqual([
      ["product_name", "text", false],
      ["quantity", "quantity", true],
      ["sales", "money", true],
    ]);
  });

  it("shows a terminal reading as KPIs with its nested payments as a table", () => {
    const p = present({
      device_id: "d",
      transactions: 2,
      sc_pwd_discounts: "13.39",
      vat_exemptions: "8.04",
      new_accumulated_grand_total: "903.57",
      payments: [{ method_kind: "CASH", amount: "903.57" }],
    });
    expect(p.type).toBe("kpis");
    if (p.type !== "kpis") return;
    expect(p.items.map((i) => [i.key, i.value])).toEqual([
      ["transactions", "2"],
      ["sc_pwd_discounts", "₱13.39"],
      ["vat_exemptions", "₱8.04"],
      ["new_accumulated_grand_total", "₱903.57"],
    ]);
    expect(p.nested).toHaveLength(1);
    expect(p.nested[0].label).toBe("Payments");
    expect(p.nested[0].presentation.type).toBe("table");
  });

  it("handles empty data", () => {
    expect(present([]).type).toBe("empty");
    expect(present(null).type).toBe("empty");
  });
});

describe("chartPoints", () => {
  it("labels hours and dates", () => {
    expect(chartPoints([{ hour: 9, sales: "50.00" }], "hour", "sales")).toEqual([{ x: "09:00", y: 50 }]);
    expect(chartPoints([{ period: "2026-09-26T00:00:00", sales: "117.17" }], "period", "sales")).toEqual([{ x: "2026-09-26", y: 117.17 }]);
  });
});
