import { describe, expect, it } from "vitest";

import { DuplicateFilter } from "./camera";

describe("camera duplicate filter", () => {
  it("ignores the same code within the window, accepts it again after", () => {
    let now = 0;
    const filter = new DuplicateFilter(1500, () => now);
    expect(filter.accept("4800361419116")).toBe(true);
    now = 500;
    expect(filter.accept("4800361419116")).toBe(false);
    now = 1900; // still in view: each sighting extends the window
    expect(filter.accept("4800361419116")).toBe(false);
    now = 3500;
    expect(filter.accept("4800361419116")).toBe(true);
  });

  it("accepts a different code immediately", () => {
    let now = 0;
    const filter = new DuplicateFilter(1500, () => now);
    expect(filter.accept("A")).toBe(true);
    now = 100;
    expect(filter.accept("B")).toBe(true);
    now = 200;
    expect(filter.accept("A")).toBe(true);
  });
});
