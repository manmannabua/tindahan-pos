# Barcode Scanner

## 1. The rule

Never: `barcode → HTTP → PostgreSQL → response → add item`.
Always: `barcode → IndexedDB index → add item`. The network is not in the scan path.

## 2. How HID scanners behave

USB and Bluetooth scanners in HID mode are keyboards. Scanning `4800361419117` produces 13
very fast `keydown` events followed by `Enter` (configurable on the scanner: Enter, Tab, or
none). Humans type ~5–10 chars/s; scanners send ~50–500 chars/s.

## 3. Detection (`lib/barcode/scanner-detector.ts`)

A small state machine, independent of React so it can be unit-tested with fake timestamps:

```
on keydown(key, timestamp):
  if gap since previous key > maxInterKeyMs (default 50 ms) → start new buffer
  if key is a terminator (Enter / Tab):
      if buffer.length ≥ minLength (default 4)
         and average gap ≤ maxAvgInterKeyMs (default 30 ms) → emit scan(buffer)
      reset
  else if key is a single printable character → append
on idle timeout (default 80 ms after last key) with no terminator:
      same check → emit (supports scanners configured without suffix)
```

`useBarcodeScanner({ onScan })` wires the detector to `window` `keydown` in the capture phase:
- When focus is **not** in an editable element, scanner keystrokes are captured and
  `preventDefault`-ed so they don't trigger shortcuts.
- When focus **is** in an editable element, the hook stays out of the way — except for elements
  marked `data-barcode-input` (the POS search box), which handle `Enter` as scan/search.
- The hook is disabled while a modal that needs typing is open.

Thresholds are configurable in POS settings because some Bluetooth scanners are slower.

## 4. Normalization (`lib/barcode/normalize.ts`)

1. Trim whitespace and strip control characters.
2. Strip an AIM symbology identifier prefix (`]E0`, `]C1`, …) if the scanner is configured to
   send one.
3. Keep the rest as-is: **no restriction to known symbologies** (internal codes, QR payloads,
   Code 128 with letters are all valid).
4. Produce lookup **candidates**, tried in order:
   - the code itself
   - UPC-A (12 digits) ↔ EAN-13 with leading `0` (same product, different printing)
   - UPC-E (8 digits, starting 0/1, valid check digit) expanded to UPC-A and EAN-13
   - Code 39 uppercase form (Code 39 has no lowercase)

`detectSymbology()` identifies EAN-13, EAN-8, UPC-A, UPC-E (with check-digit validation) and
otherwise reports `CODE128_OR_OTHER`. It is used for display and for data-quality warnings on
the admin side, not to reject scans.

### Canonical storage (server)

Barcodes are stored **canonically** (`backend/app/shared/barcodes.py`):
- A valid 12-digit UPC-A is stored as its EAN-13 form with a leading `0` — they are the same
  GTIN printed two ways, so this prevents registering one product twice.
- Everything else is stored cleaned but otherwise as-is (case preserved: Code 128 is
  case-sensitive).
- One row per code, ever. Removing a barcode deactivates the row; assigning the code to another
  product later reuses the row. Terminals therefore receive an *update*, which keeps their
  unique `code` index consistent.

The device downloads the canonical codes, and the candidate list above always contains the
canonical form of whatever the scanner sent.

### Check digits are informative, not enforced

The example code in the original specification, `4800361419117`, has an **invalid** EAN-13
check digit (the valid code is `4800361419116`). Real stores meet mislabeled or internal codes
like this. They are accepted and simply reported as `CODE128_OR_OTHER`; the admin UI can show a
data-quality warning.

## 5. Lookup (`features/pos/hooks/use-scan-to-cart.ts`)

```
for candidate in candidates:
  barcode = await db.barcodes.where("code").equals(candidate).first()   // unique index
  if barcode: break
if none → error feedback ("Not found: 4800…") + open search prefilled
variant = db.variants.get(barcode.variantId)   (inactive → error)
unit    = db.productUnits.get(barcode.productUnitId)
price   = resolvePrice(variant, unit, priceLevel, qty)   // lib/pricing
cart.addOrIncrement(variant, unit, price)
feedback: success beep + row highlight
```

Measured budget: < 10 ms from terminator key to cart update on a mid-range laptop with
50k barcodes. IndexedDB `where().equals()` on a unique index is a B-tree lookup.

## 6. Feedback

- Success: short high beep (Web Audio, no asset needed), line flash.
- Not found / inactive: low double beep, toast, search panel opens with the code.
- Sound can be disabled per terminal.

## 7. Camera scanning (mobile/tablet)

`lib/barcode/camera.ts`:
- Uses the native `BarcodeDetector` API when available (Chrome Android, Safari 17+ partial).
- Falls back to `@zxing/browser` (lazy-loaded so it never enlarges the main POS bundle).
- Emits into the **same** `onScan` path, so everything after detection is shared.
- Debounces repeats of the same code (1.5 s) so holding the camera still doesn't add 10 items.

## 8. Barcode-based stock count

The stock count screen uses the same hook with a different `onScan`: increments the counted
quantity of the scanned item instead of adding to a cart.

## 9. Barcode generation and labels

Items without a manufacturer barcode get an internal code: prefix `2` (EAN-13 "restricted
circulation" range) + company-sequential digits + check digit — valid EAN-13 that will never
collide with retail GTINs. Labels are rendered with JsBarcode to SVG and printed through the
same print pipeline as receipts (label size templates).
