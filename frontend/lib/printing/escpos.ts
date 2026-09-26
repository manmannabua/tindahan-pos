/**
 * ESC/POS encoder for thermal receipt printers. See docs/RECEIPT_PRINTING.md.
 *
 * It encodes the SAME laid-out rows as the HTML renderer (layoutReceipt), so a receipt breaks
 * lines identically on paper whichever path prints it. Output is plain ASCII (code page 437):
 * characters a basic printer can't show are transliterated (₱ → P, curly quotes → ").
 */
import { layoutReceipt, type ReceiptDocument } from "./receipt";

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** ESC p m t1 t2: pulse drawer pin 2 (m=0) for 25*2 ms on, 250*2 ms off. */
export const DRAWER_KICK = [ESC, 0x70, 0x00, 25, 250] as const;

const TRANSLITERATE: Record<string, string> = {
  "₱": "P",
  "—": "-",
  "–": "-",
  "−": "-",
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "·": "-",
  "×": "x",
  ñ: "n",
  Ñ: "N",
};

/** Printable ASCII only. Accents are stripped; anything else becomes "?". */
export function toPrinterText(text: string): string {
  let out = "";
  for (const ch of text) {
    const mapped = TRANSLITERATE[ch] ?? ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const c of mapped) {
      const code = c.charCodeAt(0);
      out += code >= 0x20 && code < 0x7f ? c : "?";
    }
  }
  return out;
}

export class EscPosEncoder {
  private readonly bytes: number[] = [];

  raw(...values: number[]): this {
    this.bytes.push(...values);
    return this;
  }

  /** ESC @ (reset) + ESC t 0 (code page 437). */
  initialize(): this {
    return this.raw(ESC, 0x40, ESC, 0x74, 0x00);
  }

  align(value: "left" | "center" | "right"): this {
    return this.raw(ESC, 0x61, { left: 0, center: 1, right: 2 }[value]);
  }

  bold(on: boolean): this {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /** GS ! n — width/height multiplier (1 or 2). */
  size(width: 1 | 2, height: 1 | 2): this {
    return this.raw(GS, 0x21, ((width - 1) << 4) | (height - 1));
  }

  text(value: string): this {
    for (const ch of toPrinterText(value)) this.bytes.push(ch.charCodeAt(0));
    return this;
  }

  line(value = ""): this {
    return this.text(value).raw(LF);
  }

  /** ESC d n — print and feed n lines. */
  feed(lines: number): this {
    return this.raw(ESC, 0x64, lines);
  }

  /** Code 128 (subset B), human-readable text below. */
  code128(value: string): this {
    const data = toPrinterText(value);
    const payload = [0x7b, 0x42, ...[...data].map((c) => c.charCodeAt(0))]; // "{B" + data
    return this.align("center")
      .raw(GS, 0x68, 60) // height
      .raw(GS, 0x77, 2) // module width
      .raw(GS, 0x48, 2) // HRI below
      .raw(GS, 0x6b, 73, payload.length, ...payload)
      .raw(LF)
      .align("left");
  }

  /** GS V 66 n — feed n and partial cut. */
  cut(): this {
    return this.raw(GS, 0x56, 66, 3);
  }

  kickDrawer(): this {
    return this.raw(...DRAWER_KICK);
  }

  encode(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }
}

/** Receipt → bytes. The drawer (if requested) opens before printing, like most POS setups. */
export function encodeReceipt(doc: ReceiptDocument, options: { kickDrawer?: boolean } = {}): Uint8Array {
  const enc = new EscPosEncoder().initialize();
  if (options.kickDrawer) enc.kickDrawer();
  let bold = false;
  for (const row of layoutReceipt(doc)) {
    if (row.barcode) {
      if (bold) enc.bold((bold = false));
      enc.code128(row.barcode);
      continue;
    }
    if (row.bold !== bold) enc.bold((bold = row.bold));
    enc.line(row.text);
  }
  if (bold) enc.bold(false);
  return enc.feed(3).cut().encode();
}

/** Just open the cash drawer (e.g. a no-sale opening). */
export function encodeDrawerKick(): Uint8Array {
  return new EscPosEncoder().initialize().kickDrawer().encode();
}
