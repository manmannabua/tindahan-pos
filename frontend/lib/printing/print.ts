/**
 * Browser printing of receipts via a hidden iframe (works offline with any installed driver).
 * Kiosk setups can suppress the dialog with Chrome `--kiosk-printing`.
 */
import { layoutReceipt, type ReceiptDocument } from "./receipt";

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** Standalone HTML document for a receipt (also used for on-screen preview). */
export function renderReceiptHtml(doc: ReceiptDocument): string {
  const rows = layoutReceipt(doc)
    .map((row) =>
      row.barcode
        ? `<div class="code">${escapeHtml(row.barcode)}</div>`
        : `<div class="${row.bold ? "b" : ""}">${escapeHtml(row.text) || "&nbsp;"}</div>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt</title><style>
@page { size: ${doc.width}mm auto; margin: 0; }
body { margin: 0; padding: 2mm; width: ${doc.width - 4}mm; font: 11px/1.25 "Courier New", monospace; color: #000; }
div { white-space: pre; }
.b { font-weight: bold; }
.code { text-align: center; letter-spacing: 2px; margin-top: 2mm; }
</style></head><body>${rows}</body></html>`;
}

/** Print through a hidden iframe. Resolves after the print dialog closes (or immediately in tests). */
export function printReceipt(doc: ReceiptDocument): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    document.body.appendChild(frame);
    const win = frame.contentWindow;
    if (!win) {
      frame.remove();
      resolve();
      return;
    }
    win.document.open();
    win.document.write(renderReceiptHtml(doc));
    win.document.close();
    const cleanup = () => {
      setTimeout(() => frame.remove(), 1000);
      resolve();
    };
    win.addEventListener("afterprint", cleanup, { once: true });
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        cleanup();
      }
      // Some browsers never fire afterprint; don't hold the POS.
      setTimeout(cleanup, 2000);
    }, 50);
  });
}
