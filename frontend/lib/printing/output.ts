/**
 * Where a document is printed: the browser (any installed driver) or an ESC/POS printer over
 * WebUSB/WebSerial, per terminal setting. ESC/POS failures fall back to browser printing so a
 * sale is never left without a receipt; the caller shows the returned warning.
 */
import type { TerminalSettings } from "@/lib/db/meta";

import { encodeDrawerKick, encodeReceipt } from "./escpos";
import { sendToPrinter } from "./escpos-transport";
import { printReceipt } from "./print";
import type { ReceiptDocument } from "./receipt";

export type PrinterMode = "browser" | "escpos-usb" | "escpos-serial";

export interface PrintOutcome {
  /** Set when ESC/POS failed and the browser printed instead. */
  fallbackReason: string | null;
}

type PrinterSettings = Pick<TerminalSettings, "printerMode" | "serialBaudRate">;

export async function printDocument(
  doc: ReceiptDocument,
  settings: PrinterSettings,
  options: { kickDrawer?: boolean } = {},
): Promise<PrintOutcome> {
  if (settings.printerMode === "browser") {
    await printReceipt(doc);
    return { fallbackReason: null };
  }
  try {
    await sendToPrinter(settings.printerMode, encodeReceipt(doc, options), { baudRate: settings.serialBaudRate });
    return { fallbackReason: null };
  } catch (error) {
    await printReceipt(doc);
    return { fallbackReason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Open the cash drawer. Only possible with ESC/POS (the drawer hangs off the printer); with
 * browser printing, configure the printer driver to open it on every job instead.
 */
export async function openCashDrawer(settings: PrinterSettings): Promise<boolean> {
  if (settings.printerMode === "browser") return false;
  try {
    await sendToPrinter(settings.printerMode, encodeDrawerKick(), { baudRate: settings.serialBaudRate });
    return true;
  } catch {
    return false;
  }
}
