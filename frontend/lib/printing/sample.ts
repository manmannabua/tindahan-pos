import type { ReceiptDocument, ReceiptWidth } from "./receipt";

/** Printer test page: alignment, bold, a full-width rule, and a barcode. */
export function buildReceiptSample(width: ReceiptWidth): ReceiptDocument {
  return {
    width,
    lines: [
      { kind: "center", text: "PRINTER TEST", bold: true },
      { kind: "rule" },
      { kind: "pair", left: "Paper", right: `${width} mm` },
      { kind: "pair", left: "Left", right: "Right" },
      { kind: "text", text: "The quick brown fox jumps over the lazy dog 0123456789" },
      { kind: "rule" },
      { kind: "barcode", value: "TEST-000001" },
    ],
  };
}
