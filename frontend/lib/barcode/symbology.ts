/**
 * Barcode symbology detection and GS1 check digits.
 *
 * Used for display and data-quality warnings — never to reject a scan. Internal codes, Code 128
 * with letters, etc. are all valid barcodes as far as the POS is concerned.
 */

export type Symbology = "EAN13" | "EAN8" | "UPC_A" | "UPC_E" | "CODE39" | "CODE128_OR_OTHER";

const DIGITS = /^\d+$/;
/** Characters Code 39 can encode (no lowercase). */
export const CODE39_CHARSET = /^[0-9A-Z \-.$/+%]+$/;

/** GS1 mod-10 check digit for the given digits (without the check digit). */
export function gs1CheckDigit(digitsWithoutCheck: string): number {
  let sum = 0;
  // Weights alternate 3,1,3,... starting from the rightmost digit.
  for (let i = 0; i < digitsWithoutCheck.length; i++) {
    const digit = digitsWithoutCheck.charCodeAt(digitsWithoutCheck.length - 1 - i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10;
}

export function hasValidGs1CheckDigit(code: string): boolean {
  if (!DIGITS.test(code) || code.length < 2) return false;
  return gs1CheckDigit(code.slice(0, -1)) === Number(code[code.length - 1]);
}

/**
 * Expand an 8-digit UPC-E (number system 0 or 1) to its 12-digit UPC-A form.
 * Returns null if the input isn't a UPC-E with a valid check digit.
 */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const ns = code[0];
  const [x1, x2, x3, x4, x5, x6] = code.slice(1, 7);
  const check = code[7];
  let body: string;
  switch (x6) {
    case "0":
    case "1":
    case "2":
      body = `${x1}${x2}${x6}0000${x3}${x4}${x5}`;
      break;
    case "3":
      body = `${x1}${x2}${x3}00000${x4}${x5}`;
      break;
    case "4":
      body = `${x1}${x2}${x3}${x4}00000${x5}`;
      break;
    default:
      body = `${x1}${x2}${x3}${x4}${x5}0000${x6}`;
  }
  const upcA = `${ns}${body}${check}`;
  return hasValidGs1CheckDigit(upcA) ? upcA : null;
}

export function detectSymbology(code: string): Symbology {
  if (DIGITS.test(code)) {
    if (code.length === 13 && hasValidGs1CheckDigit(code)) return "EAN13";
    if (code.length === 12 && hasValidGs1CheckDigit(code)) return "UPC_A";
    if (code.length === 8) {
      if (hasValidGs1CheckDigit(code)) return "EAN8";
      if (expandUpcE(code)) return "UPC_E";
    }
    // All-digit codes that aren't valid GS1 codes (bad check digit, other lengths).
    return "CODE128_OR_OTHER";
  }
  if (CODE39_CHARSET.test(code)) return "CODE39";
  return "CODE128_OR_OTHER";
}
