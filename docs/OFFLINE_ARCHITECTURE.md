# Offline Architecture

Goal: **a properly initialized terminal serves customers with no server for an hour or more**,
and after reconnecting, every transaction arrives exactly once.

---

## 1. What must work offline

| Works offline | Needs the server |
|---|---|
| Cashier PIN login (previously synced staff) | First-time device registration and initialization |
| Barcode scan (keyboard wedge and camera) | Admin portal (products, reports, users…) |
| Product search, price lookup, quantity breaks | Voiding a sale made on *another* terminal |
| Cart, discounts within the cashier's limit, hold/recall | Returns against a sale not stored on this device |
| Manager authorization (manager PIN verified locally) | Stock transfers between branches |
| Cash, GCash/Maya/card/bank *recording*, split payments | Purchasing, goods receiving |
| Receipt printing & reprint | Live dashboard, realtime notifications |
| Cash session open / cash in-out / close with over/short | |
| Local stock estimate and low-stock warnings | |

GCash/Maya/card are **recorded** (method, amount, reference number) — the actual e-wallet or
card terminal is a separate device, so recording works offline.

---

## 2. Layers

```
┌──────────────────────────────────────────────────────────────────┐
│ Service worker (Serwist)                                         │
│   precaches: /pos, /pos/login, /pos/setup, JS/CSS chunks, fonts, │
│   icons, manifest. Does NOT cache /api/*                         │
├──────────────────────────────────────────────────────────────────┤
│ React POS UI (client components)                                 │
│   Zustand: cart, terminal status, UI state                       │
│   useBarcodeScanner → lib/barcode → lib/db lookup                │
├──────────────────────────────────────────────────────────────────┤
│ lib/db  (Dexie) — the operational database                       │
│   catalog, inventory snapshot, sales, payments, cash, outbox     │
├──────────────────────────────────────────────────────────────────┤
│ lib/sync — background engine (one tab via Web Locks)             │
│   push outbox → pull changes → reconcile inventory               │
└──────────────────────────────────────────────────────────────────┘
```

### Why the service worker does not cache API responses
A cached `GET /products` response is a snapshot with no cursor, no conflict handling, no
partial updates, and no way for the UI to know how old it is. Explicit sync into IndexedDB gives
us all of those. The service worker's only job is to make the **application code** available
offline.

### Why the POS route is static
`/pos` is pre-rendered at build time (`dynamic = "force-static"`) and reads everything from
IndexedDB on the client. If it were server-rendered per request, opening the POS would need
the Next.js server — exactly what we can't depend on.

---

## 3. The checkout path (no network anywhere)

```
Scanner types "4800361419117⏎"
  → useBarcodeScanner (keystroke timing says: scanner)
  → normalizeBarcode()  → candidates ["4800361419117"]
  → db.barcodes.where("code").equals(c).first()     (IndexedDB index, ~1 ms)
  → load variant, product unit, price for current price level & qty
  → cartStore.addLine() / increment quantity         (Zustand → instant render)
  → cart checkpoint → db.activeCart (debounced)       (crash safety)

Pay
  → completeSale(): ONE Dexie transaction writes
       sales, saleItems, payments,
       inventoryMovements (provisional), inventory (decrement),
       outbox("sale.complete", priority 10),
       meta.receiptSeq++
  → print receipt (browser print / ESC-POS)
  → sync engine is nudged (non-blocking)
```

---

## 4. Storage durability

- On initialization the POS calls `navigator.storage.persist()`. Without it, browsers may evict
  IndexedDB under storage pressure. The result is shown in the device status page; if
  persistence is denied (e.g. Safari without installation), the UI warns that the PWA should be
  installed.
- `navigator.storage.estimate()` is displayed so managers can see usage.
- iOS/iPadOS Safari evicts script-writable storage for sites not used in 7 days **unless the app
  is installed to the home screen**. Installation is required on Apple devices.
- Unsynced data is never pruned. Pruning of synced history is time-based and configurable.

---

## 5. Restart / crash behaviour

| Situation | What happens |
|---|---|
| Browser closed mid-cart | `activeCart` checkpoint restored on next open |
| Browser killed during `completeSale` | Dexie transaction rolled back; cart still in checkpoint; cashier completes again |
| Browser killed during sync | `SYNCING` rows reset to `PENDING` on start; resend is idempotent |
| Server acknowledged, response lost | Next push returns `DUPLICATE` → marked `SYNCED` |
| Device clock wrong | `occurred_at` is kept as reported, `received_at` is server time; devices report clock skew on sync and large skew is flagged |

---

## 6. Connectivity detection

`navigator.onLine === true` only means *a* network interface is up — not that the API is
reachable. The connectivity monitor therefore:
- listens to `online`/`offline` events (fast hint),
- polls `GET /api/v1/health` (3 s timeout) every 15 s while visible,
- marks online after one success, offline after two consecutive failures.

---

## 7. Offline limits (by design)

- **Offline authentication duration**: a staff verifier is valid offline for a configurable
  window (default 7 days since that user's last online verification on any device of the
  branch). After that, online login is required.
- **Maximum offline period** is not enforced for sales (the business must keep selling), but the
  UI escalates warnings after 24 h without sync.
- **Prices** used offline are the last synced prices. A price change made centrally while a
  terminal is offline applies after the next pull. The receipt shows the price actually charged.

---

## Implementation notes (Phase 3/4 frontend)

Where the implementation refines the design above:

- **One page for the whole terminal.** PIN login, selling, cash, sales history and the sync
  monitor are views inside `/pos`, switched in memory. The cashier session is memory-only, so a
  page navigation would log the cashier out; views also avoid any dependency on route payloads.
  `/pos/setup` remains a separate page (it needs the network anyway).
- **The scan input owns scans.** When the scan box has focus (the default; focus returns to it
  after each sale), Enter looks up the *whole* typed value. The keystroke-timing detector is used
  only when focus is elsewhere. Timing can be distorted when the main thread is busy; the input
  path cannot lose characters.
- **Backoff is reset on reconnect.** Pending operations may have accumulated minutes of backoff
  during an outage; when the server becomes reachable again every pending operation is made due
  immediately.
- **Reconciliation boundary.** A provisional stock movement is dropped only after a pull *pass*
  that started after its sale was acknowledged has completed (`pullPassStartedAt`), so a pass
  resumed from an older cursor can never double-subtract or lose a sale's quantity.
- **Checkpoint vs. completed sale.** The cart checkpoint is deleted inside the sale transaction,
  and a debounced checkpoint write re-checks whether the cart's first line is already a sale item
  (cart line ids become sale item ids), so a completed cart is never restored after a crash.

### Phase 7 on the terminal (implementation notes)

- **Promotions** are evaluated locally by `lib/promotions/evaluate.ts`, a mirror of `backend/app/modules/promotions/evaluator.py` pinned by `shared/test-vectors/promotions.json`. The cart re-evaluates them after every change and once a minute, so time windows take effect in an open cart. An applied promotion becomes an ordinary AMOUNT line discount with `promotion_id`. A manual discount wins, and the cashier can remove a promotion from a line.
- **Customers** can be created offline with `customer.upsert` at priority 8, so they sync before the sales that reference them. Picking a customer switches the price level.
- **Voids** (`sale.void`, priority 15) are allowed only for sales in the open shift. **Returns** (`return.create`, priority 50) refund each item's paid share; the last units get exactly the remaining amount, so rounding never drifts. They are numbered `{prefix}R{seq}` from their own local sequence, stored in the Dexie **v2** tables `returns`, `returnItems` and `refunds`. Expected cash excludes voided sales and subtracts cash refunds, the same as the server.
- The engine acknowledges provisional movements **per operation type** (SALE / SALE_VOID / SALE_RETURN), because a sale and its later void share the same reference id.
- **Camera scanning** uses `BarcodeDetector`, or `@zxing/browser` loaded lazily when it isn't available. Repeats of the same code within 1.5 s are ignored. **Terminal settings** (manager only) are stored in Dexie `settings`. A **service-worker update** is applied only when the cart is empty.
- **Build:** the service worker is bundled with native esbuild on Windows (Serwist's default). esbuild-wasm fails on Windows drive paths, so `esbuild` is a direct dev dependency.
