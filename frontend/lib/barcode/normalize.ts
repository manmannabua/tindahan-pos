/**
 * Barcode normalization and lookup candidates. See docs/BARCODE_SCANNER.md §4.
 *
 * Barcodes are stored normalized on both the server and the device, and a scan is looked up by
 * trying each candidate in order against the IndexedDB `barcodes.code` unique index.
 */
import { expandUpcE, hasValidGs1CheckDigit } from "./symbology";

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
/** AIM symbology identifier, e.g. "]E0" (EAN-13), "]C1" (GS1-128), sent by some scanners. */
const AIM_PREFIX = /^\][A-Za-z][0-9A-Za-z]/;

/** Canonical form of a scanned or typed code. Returns "" if nothing usable remains. */
export function normalizeBarcode(raw: string): string {
  return raw.replace(CONTROL_CHARS, "").trim().replace(AIM_PREFIX, "").trim();
}

/**
 * The form the server stores (backend app/shared/barcodes.py): a valid 12-digit UPC-A is stored
 * as EAN-13 (leading "0"); everything else as normalized, case preserved.
 */
export function canonicalBarcode(raw: string): string {
  const code = normalizeBarcode(raw);
  return /^\d{12}$/.test(code) && hasValidGs1CheckDigit(code) ? `0${code}` : code;
}

/**
 * Codes to try, in order. The same physical product can be encoded differently:
 * UPC-A `036000291452` is EAN-13 `0036000291452`; UPC-E `04252614` is UPC-A `042100005264`.
 */
export function barcodeCandidates(raw: string): string[] {
  const code = normalizeBarcode(raw);
  if (!code) return [];
  const candidates: string[] = [code];

  if (/^\d{12}$/.test(code) && hasValidGs1CheckDigit(code)) {
    candidates.push(`0${code}`);
  } else if (/^0\d{12}$/.test(code)) {
    candidates.push(code.slice(1));
  } else if (/^[01]\d{7}$/.test(code)) {
    const upcA = expandUpcE(code);
    if (upcA) candidates.push(upcA, `0${upcA}`);
  }

  const upper = code.toUpperCase();
  if (upper !== code) {
    // Code 39 has no lowercase; a scanner in the wrong case mode can still be matched.
    candidates.push(upper);
  }

  return [...new Set(candidates)];
}
