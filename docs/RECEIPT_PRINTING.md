# Receipt Printing

## 1. Requirements

58 mm and 80 mm thermal printers, offline, reprint from history, no server involvement.

## 2. Architecture

```
Sale (from Dexie)
  → buildReceipt(sale, items, payments, settings)  → ReceiptDocument (plain data)
  → renderer
       ├─ HtmlReceiptRenderer   → hidden iframe → window.print()   (default, universal)
       └─ EscPosRenderer        → bytes → WebUSB / WebSerial       (optional, Chromium only)
```

`ReceiptDocument` is a small, printer-independent model (header lines, item rows, totals,
payments, footer, barcode of receipt number). Both renderers consume it, and it is unit-tested
without a printer.

### Why browser printing by default
It works with any installed printer driver on Windows/macOS/Android, needs no permission
prompts and is fully offline. Kiosk setups can remove the print dialog:
Chrome `--kiosk-printing`, or setting the thermal printer as default.

### Why ESC/POS as an option
Direct ESC/POS is faster, supports cash-drawer kick (`ESC p`) and doesn't depend on driver
margins. It needs WebUSB/WebSerial (Chromium desktop/Android), so it is opt-in per terminal.

## 3. Paper widths

| Width | Printable | Characters per line (Font A) | CSS |
|---|---|---|---|
| 58 mm | ~48 mm | 32 | `@page { size: 58mm auto; margin: 0 }` |
| 80 mm | ~72 mm | 48 | `@page { size: 80mm auto; margin: 0 }` |

The HTML renderer uses a monospace layout driven by the same "characters per line" value, so
both renderers produce the same line breaks.

## 4. Content

Business name, branch, TIN, address · receipt number · date/time · terminal · cashier ·
customer (if any) · items (name, qty × price, line total, discounts) · subtotal, discount, VAT
breakdown (VATable, VAT-exempt, zero-rated, VAT amount) · total · payments (method, reference,
tendered, change) · footer text · `REPRINT` marker on reprints · receipt-number barcode (Code 128).

> BIR (Philippines) accreditation requirements for official receipts/invoices are out of scope
> of this codebase. The receipt model contains the fields commonly required so it can be
> adapted.

## 5. Reprint

Reprints read the sale from IndexedDB (or from the API for older sales when online), render
with `isReprint = true`, and record an audit event `sale.receipt_reprinted`.

## 6. Cash drawer

With ESC/POS, the drawer opens via the printer's kick command when a payment method has
`opens_drawer = true`. With browser printing, most drivers can be configured to kick the drawer
on each print job.
