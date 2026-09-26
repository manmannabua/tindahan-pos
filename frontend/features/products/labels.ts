/**
 * Barcode label layout. Rendering (JsBarcode) and printing live in the components; everything
 * here is pure so it can be unit-tested.
 */

export type LabelFormat = "EAN13" | "EAN8" | "UPC" | "CODE128";

function gtinValid(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop() ?? 0;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** EAN/UPC when the code is a valid GTIN of that length; CODE128 for anything else. */
export function labelFormat(code: string): LabelFormat {
  if (code.length === 13 && gtinValid(code)) return "EAN13";
  if (code.length === 12 && gtinValid(code)) return "UPC";
  if (code.length === 8 && gtinValid(code)) return "EAN8";
  return "CODE128";
}

export interface LabelSize {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
  /** Sheet layout; absent = continuous roll (one label per printed page). */
  sheet?: { columns: number; rows: number; pageWidthMm: number; pageHeightMm: number; marginMm: number };
}

export const LABEL_SIZES: LabelSize[] = [
  { id: "38x25", name: "38 × 25 mm roll", widthMm: 38, heightMm: 25 },
  { id: "50x30", name: "50 × 30 mm roll", widthMm: 50, heightMm: 30 },
  {
    id: "a4-3x8",
    name: "A4 sheet, 3 × 8 (70 × 37 mm)",
    widthMm: 70,
    heightMm: 37,
    sheet: { columns: 3, rows: 8, pageWidthMm: 210, pageHeightMm: 297, marginMm: 0 },
  },
];

export interface LabelItem {
  key: string;
  name: string;
  code: string;
  /** Formatted price, or null to omit. */
  price: string | null;
  copies: number;
}

export interface Label {
  key: string;
  name: string;
  code: string;
  price: string | null;
  format: LabelFormat;
}

/** One entry per physical label (copies expanded, items without a code skipped). */
export function expandLabels(items: LabelItem[]): Label[] {
  const labels: Label[] = [];
  for (const item of items) {
    if (!item.code) continue;
    const copies = Math.max(0, Math.min(500, Math.floor(item.copies)));
    for (let i = 0; i < copies; i += 1) {
      labels.push({ key: `${item.key}-${i}`, name: item.name, code: item.code, price: item.price, format: labelFormat(item.code) });
    }
  }
  return labels;
}

/** Split labels into printed pages: one per label on rolls, `columns × rows` per sheet. */
export function paginate<T>(labels: T[], size: LabelSize): T[][] {
  const perPage = size.sheet ? size.sheet.columns * size.sheet.rows : 1;
  const pages: T[][] = [];
  for (let i = 0; i < labels.length; i += perPage) pages.push(labels.slice(i, i + perPage));
  return pages;
}

/** CSS @page rule for the chosen size (rolls print one label per page). */
export function pageCss(size: LabelSize): string {
  const w = size.sheet?.pageWidthMm ?? size.widthMm;
  const h = size.sheet?.pageHeightMm ?? size.heightMm;
  return `@page { size: ${w}mm ${h}mm; margin: ${size.sheet?.marginMm ?? 0}mm; }`;
}

/** Truncate a product name to fit roughly on a label of the given width. */
export function fitName(name: string, widthMm: number): string {
  const max = Math.max(12, Math.floor(widthMm * 0.9));
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}
