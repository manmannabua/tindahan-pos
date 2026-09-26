import { describe, expect, it } from "vitest";

import { featureForRoute, isFeatureOn } from "./features";

describe("features", () => {
  it("treats missing keys as on (like the server)", () => {
    expect(isFeatureOn({}, "inventory")).toBe(true);
    expect(isFeatureOn(undefined, "bir")).toBe(true);
    expect(isFeatureOn({ bir: false }, "bir")).toBe(false);
  });

  it("maps admin routes to their feature", () => {
    expect(featureForRoute("/inventory/counts/abc")).toBe("inventory");
    expect(featureForRoute("/purchase-orders/receipts")).toBe("purchasing");
    expect(featureForRoute("/sales/returns/r1")).toBe("returns");
    expect(featureForRoute("/sales/123")).toBeNull();
    expect(featureForRoute("/receipts")).toBe("receipt_journal");
    expect(featureForRoute("/products")).toBeNull();
    expect(featureForRoute("/inventoryx")).toBeNull();
  });
});
