import { describe, expect, it } from "vitest";

import { fitWithin } from "./resize";

describe("fitWithin", () => {
  it("scales the longest side down to the maximum, keeping the ratio", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1080, 1920)).toEqual({ width: 450, height: 800 });
  });

  it("never upscales small photos", () => {
    expect(fitWithin(320, 240)).toEqual({ width: 320, height: 240 });
  });

  it("never returns zero dimensions", () => {
    expect(fitWithin(10000, 1)).toEqual({ width: 800, height: 1 });
  });
});
