import { describe, expect, it } from "vitest";

import type { StockCountLine } from "@/types/api-admin";

import { countScanReducer, initialCountScan, summarize, variance } from "./count-scan";

const line = (over: Partial<StockCountLine>): StockCountLine => ({
  id: "l1",
  variant_id: "v1",
  counted_quantity: "1.000",
  system_quantity: "10.000",
  variance: null,
  counted_by_id: "u",
  counted_at: "2026-09-26T10:00:00Z",
  ...over,
});

describe("countScanReducer", () => {
  it("tracks scans from pending to ok and keeps the server's counted quantity", () => {
    let state = countScanReducer(initialCountScan, { type: "scan-started", id: "s1", code: "4800361419116" });
    expect(state.log[0]).toMatchObject({ status: "pending", code: "4800361419116" });
    state = countScanReducer(state, { type: "scan-ok", id: "s1", line: line({ counted_quantity: "3.000" }) });
    expect(state.log[0].status).toBe("ok");
    expect(state.rows.v1.counted).toBe("3.000");
  });

  it("ignores an older response arriving after a newer one", () => {
    let state = countScanReducer(initialCountScan, { type: "scan-started", id: "a", code: "x" });
    state = countScanReducer(state, { type: "scan-started", id: "b", code: "x" });
    state = countScanReducer(state, { type: "scan-ok", id: "b", line: line({ counted_quantity: "2.000", counted_at: "2026-09-26T10:00:02Z" }) });
    state = countScanReducer(state, { type: "scan-ok", id: "a", line: line({ counted_quantity: "1.000", counted_at: "2026-09-26T10:00:01Z" }) });
    expect(state.rows.v1.counted).toBe("2.000");
    expect(state.log.every((e) => e.status === "ok")).toBe(true);
  });

  it("records failures without touching counts", () => {
    let state = countScanReducer(initialCountScan, { type: "loaded", lines: [line({})] });
    state = countScanReducer(state, { type: "scan-started", id: "s", code: "nope" });
    state = countScanReducer(state, { type: "scan-failed", id: "s", message: "Barcode nope not found" });
    expect(state.log[0]).toMatchObject({ status: "error", message: "Barcode nope not found" });
    expect(state.rows.v1.counted).toBe("1.000");
  });

  it("caps the scan log", () => {
    let state = initialCountScan;
    for (let i = 0; i < 40; i += 1) state = countScanReducer(state, { type: "scan-started", id: String(i), code: "c" });
    expect(state.log).toHaveLength(25);
    expect(state.log[0].id).toBe("39");
  });
});

describe("variance summary", () => {
  it("classifies lines as over, short or exact", () => {
    const rows = [
      { variantId: "a", counted: "12", system: "10", countedAt: "" },
      { variantId: "b", counted: "3", system: "10", countedAt: "" },
      { variantId: "c", counted: "5.5", system: "5.500", countedAt: "" },
    ];
    expect(summarize(rows)).toEqual({ lines: 3, over: 1, short: 1, exact: 1 });
    expect(variance(rows[1])).toBe("-7");
  });
});
