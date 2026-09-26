import { describe, expect, it } from "vitest";

import { barcodeCandidates, canonicalBarcode, normalizeBarcode } from "./normalize";
import { detectSymbology, expandUpcE, gs1CheckDigit, hasValidGs1CheckDigit } from "./symbology";

describe("gs1 check digits", () => {
  it("computes check digits for EAN-13, UPC-A and EAN-8", () => {
    expect(gs1CheckDigit("480036141911")).toBe(6); // EAN-13 4800361419116
    expect(gs1CheckDigit("03600029145")).toBe(2); // UPC-A 036000291452
    expect(gs1CheckDigit("9638507")).toBe(4); // EAN-8 96385074
  });

  it("validates complete codes", () => {
    expect(hasValidGs1CheckDigit("4800361419116")).toBe(true);
    expect(hasValidGs1CheckDigit("4800361419117")).toBe(false);
    expect(hasValidGs1CheckDigit("036000291452")).toBe(true);
    expect(hasValidGs1CheckDigit("96385074")).toBe(true);
    expect(hasValidGs1CheckDigit("abc")).toBe(false);
  });
});

describe("UPC-E expansion", () => {
  it("expands each UPC-E pattern", () => {
    expect(expandUpcE("04252614")).toBe("042100005264"); // last digit 0-2
    expect(expandUpcE("01234531")).toBe("012300000451"); // last digit 3
    expect(expandUpcE("01234532")).toBeNull(); // bad check digit
  });

  it("rejects wrong lengths and number systems", () => {
    expect(expandUpcE("4252614")).toBeNull();
    expect(expandUpcE("24252614")).toBeNull();
  });
});

describe("detectSymbology", () => {
  it("identifies GS1 symbologies", () => {
    expect(detectSymbology("4800361419116")).toBe("EAN13");
    expect(detectSymbology("036000291452")).toBe("UPC_A");
    expect(detectSymbology("96385074")).toBe("EAN8");
    expect(detectSymbology("04252614")).toBe("UPC_E");
  });

  it("falls back for anything else without rejecting it", () => {
    expect(detectSymbology("4800361419117")).toBe("CODE128_OR_OTHER"); // bad check digit
    expect(detectSymbology("123456789")).toBe("CODE128_OR_OTHER"); // digits, not GS1
    expect(detectSymbology("abc_123")).toBe("CODE128_OR_OTHER");
    expect(detectSymbology("Item-42/x")).toBe("CODE128_OR_OTHER");
  });

  it("identifies Code 39 compatible strings containing a non-digit", () => {
    expect(detectSymbology("ABC-123")).toBe("CODE39");
    expect(detectSymbology("SKU0001")).toBe("CODE39");
  });
});

describe("normalizeBarcode", () => {
  it("trims whitespace and control characters", () => {
    expect(normalizeBarcode("  4800361419117\r\n")).toBe("4800361419117");
    expect(normalizeBarcode("\u00024800361419117\u0003")).toBe("4800361419117");
  });

  it("strips an AIM symbology identifier", () => {
    expect(normalizeBarcode("]E04800361419116")).toBe("4800361419116");
    expect(normalizeBarcode("]C1ABC123")).toBe("ABC123");
  });

  it("keeps arbitrary scanner strings", () => {
    expect(normalizeBarcode("Item-42/x")).toBe("Item-42/x");
    expect(normalizeBarcode("   ")).toBe("");
  });
});

describe("canonicalBarcode (matches backend storage form)", () => {
  it("stores valid UPC-A as EAN-13", () => {
    expect(canonicalBarcode("036000291452")).toBe("0036000291452");
    expect(canonicalBarcode(" ]E04800361419116\n")).toBe("4800361419116");
    expect(canonicalBarcode("036000291453")).toBe("036000291453"); // invalid check digit: as-is
    expect(canonicalBarcode("abc-123")).toBe("abc-123"); // case preserved
  });
});

describe("barcodeCandidates", () => {
  it("returns the code first", () => {
    expect(barcodeCandidates("4800361419117")[0]).toBe("4800361419117");
  });

  it("maps UPC-A to EAN-13 and back", () => {
    expect(barcodeCandidates("036000291452")).toEqual(["036000291452", "0036000291452"]);
    expect(barcodeCandidates("0036000291452")).toEqual(["0036000291452", "036000291452"]);
  });

  it("only maps 12-digit codes with a valid UPC-A check digit", () => {
    expect(barcodeCandidates("036000291453")).toEqual(["036000291453"]);
  });

  it("accepts codes with invalid check digits as-is", () => {
    expect(barcodeCandidates("4800361419117")).toEqual(["4800361419117"]);
  });

  it("expands UPC-E", () => {
    expect(barcodeCandidates("04252614")).toEqual(["04252614", "042100005264", "0042100005264"]);
  });

  it("adds an uppercase candidate when it differs (Code 39 has no lowercase)", () => {
    expect(barcodeCandidates("abc-123")).toEqual(["abc-123", "ABC-123"]);
    expect(barcodeCandidates("ABC-123")).toEqual(["ABC-123"]);
  });

  it("returns nothing for empty input", () => {
    expect(barcodeCandidates(" \n")).toEqual([]);
  });
});
