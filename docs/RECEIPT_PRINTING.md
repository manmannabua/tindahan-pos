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

### BIR fields

The data BIR requires on POS receipts/invoices is stored and printed:
- company: registered (legal) name, business name, TIN with **"VAT REG TIN"** or
  **"NON-VAT REG TIN"** (`companies.vat_registered`), accreditation number
  (`companies.bir_accreditation_no`)
- branch: address, branch TIN, header/footer text (e.g. the invoice disclaimer)
- terminal: **MIN**, serial number, **PTU** number and date (`devices.bir_*`, edited in the admin
  portal and delivered to the terminal through `/sync/context`)
- senior citizen / PWD: holder name, ID number, TIN, signature line, VAT exemption and the 20%
  discount shown separately

**Readings.** `GET /reports/terminal-reading?device_id=…` is the server-side X/Z reading
(first/last receipt, gross, regular and SC/PWD discounts, VAT exemptions, returns, voids,
net, VATable/VAT/exempt/zero-rated sales, payments by method, old/new accumulated grand total).
The POS prints the same reading from local data, using a non-resettable local grand-total
counter.

> Having these fields does not make the software BIR-accredited. Accreditation (and a PTU per
> terminal) is a formal process with BIR; the fields and reports here are what that process
> typically inspects.

## 5. Receipt journal ("virtual receipts") and reprints

Every receipt a terminal issues is stored **as issued** — the laid-out `ReceiptLine[]`, not
re-rendered later — whether it was printed or not:

- **Terminal:** `receipts` table (Dexie v4), written by `addReceipt` inside the same transaction
  as the sale or return (`completeSale` / `createReturn` take a `buildReceipt` callback), so a
  sale can never exist without its receipt. The id is `derivedId(saleId | returnId, "RECEIPT")`.
- **Printing** (`printFromJournal`) always prints the stored copy. The first print is the
  original; later ones get `*** REPRINT ***` after the header. Each print updates the local
  state (`NOT_PRINTED` → `BROWSER` "sent to the print dialog" / `PRINTED` "confirmed by the
  thermal printer") and queues a `receipt.print` event.
- **Server:** `receipts` + `receipt_prints`, both **append-only** (database trigger), filled only
  by sync (`receipt.issue`, `receipt.print`). Print counts are derived from the print log. This
  is the electronic journal BIR expects a POS to keep.
- **Where to see them:** POS → *Receipts* (works offline: search, "Not printed" filter, virtual
  receipt, Print / Reprint) and admin → *Sales → Receipts* (all terminals, print history, a
  back-office "Print copy" marked `*** COPY ***`, which is not counted as a terminal print), also
  *View receipt* on a sale.
- Sales made before the journal existed get entries the first time the Receipts screen opens
  (`ensureJournal`), marked `reconstructed` because they are rebuilt from today's header data.

## 6. Cash drawer

With ESC/POS, the drawer opens via the printer's kick command when a payment method has
`opens_drawer = true`. With browser printing, most drivers can be configured to kick the drawer
on each print job.

## 7. Implementation notes (frontend)

- `lib/printing/receipt.ts` lays out every document (receipt, return slip, X/Z reading) as
  fixed-width rows (32 columns at 58 mm, 48 at 80 mm); the HTML and ESC/POS paths both print
  those rows, so line breaks match. `birHeaderLines()` is the shared BIR header.
- `lib/printing/escpos.ts` encodes rows as ASCII (code page 437, non-ASCII transliterated):
  `ESC @`, `ESC t 0`, `ESC E` for bold, Code 128 (`GS k 73`, subset B) for the receipt
  barcode, `ESC d 3` + `GS V 66 3` to feed and cut. The drawer kick (`ESC p 0 25 250`) is sent
  before the receipt when a payment method opens the drawer.
- `lib/printing/escpos-transport.ts` talks to printers over WebUSB (printer class 7, bulk OUT
  endpoint, 4 KB chunks) or WebSerial (baud rate per terminal, 9600 by default). Pairing is done
  once in POS → Settings → Printer and the browser remembers the device.
- `lib/printing/output.ts` picks the path from the terminal setting (`printerMode`: browser,
  escpos-usb or escpos-serial). If ESC/POS fails, it prints through the browser instead and the
  POS shows a warning toast, so a sale always gets a receipt.
- X/Z readings (`lib/pos/readings.ts`) come from IndexedDB. `meta.grandTotal` goes up in the
  `completeSale` transaction and down on a local void. Schema v3 seeds it from existing sales.
  A Z-reading bumps `meta.zCount` and moves `meta.lastZAt` in one transaction.
