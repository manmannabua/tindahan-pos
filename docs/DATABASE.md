# Database Design

There are two databases with different jobs:

| | PostgreSQL | IndexedDB (Dexie) |
|---|---|---|
| Role | Central source of truth | Operational database of **one** POS terminal |
| Scope | All companies, branches, history | One branch's catalog + this device's transactions |
| Written by | FastAPI services | POS UI + sync engine |
| Durability | Backups, WAL | Browser storage (persistent-storage permission requested) |

Status legend: ✅ implemented · 🟡 designed, implemented in a later phase.

---

## 1. PostgreSQL conventions

| Convention | Rule | Why |
|---|---|---|
| Primary keys | `id UUID` (UUIDv7) | Offline-created records need IDs before reaching the server. v7 is time-ordered → good index locality. |
| Tenancy | `company_id UUID NOT NULL` on every tenant table, indexed | Every query is scoped by the caller's company. |
| Money | `NUMERIC(14,2)` | Exact decimals. Never `FLOAT`. |
| Unit cost | `NUMERIC(14,4)` | Costs are often fractional centavos after unit conversion (₱100 / 12 pcs). |
| Quantity | `NUMERIC(14,3)` | Supports weighed goods (0.250 kg) and unit conversions. |
| Rates | `NUMERIC(6,3)` | `12.000` = 12 % |
| Time | `TIMESTAMPTZ`, stored UTC | Branches may be in different time zones; reports convert with `AT TIME ZONE company.timezone`. |
| Audit columns | `created_at`, `updated_at` (server clock) | |
| Business time | `occurred_at` on offline-origin records (device clock) | Offline sales happen before the server knows about them. `received_at` records when the server got them. |
| Sync columns | `sync_txid BIGINT` on tables the POS downloads | Change feed cursor. Set by trigger. See [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md#pull). |
| Soft delete | `is_active` / status columns for master data | Deletions must propagate to offline terminals as updates; hard deletes can't be pulled. Financial rows are never deleted — they are voided/reversed. |
| Enums | `VARCHAR` + `CHECK` constraint, Python `StrEnum` | Adding a value to a native PG enum needs a migration that can't run inside some transactions; a CHECK is easier to evolve. |
| Naming | constraint naming convention in SQLAlchemy `MetaData` | Alembic autogenerate produces deterministic, reviewable names (`uq_barcodes_company_id_code`). |
| Search | `pg_trgm` GIN indexes on `products.name`, `product_variants.sku`, `customers.name` | `ILIKE '%text%'` cannot use a B-tree; trigram indexes keep search fast with large catalogs. |

### Why UUIDv7 for server-created rows too?
One ID scheme everywhere means the POS can reference any record the same way, and IDs never
collide across devices or with the server.

---

## 2. Entity overview

```
companies ─┬─ branches ─┬─ stock_locations
           │            └─ devices (terminals)
           ├─ users ── user_roles ── roles ── role_permissions
           ├─ categories, brands, units, tax_rates, price_levels, payment_methods
           ├─ products ─┬─ product_units (unit conversions)
           │            └─ product_variants ─┬─ barcodes
           │                                 └─ prices
           ├─ inventory_movements (ledger, append-only) ──► inventory_balances (cache)
           ├─ cash_sessions ─ cash_movements
           ├─ sales ─┬─ sale_items
           │         └─ payments
           ├─ returns ─ return_items ─ refunds
           ├─ suppliers ─ purchase_orders ─ purchase_order_lines
           │                       └─ goods_receipts ─ goods_receipt_lines
           ├─ stock_counts, stock_adjustments, stock_transfers (+ lines)
           ├─ customers, promotions, expenses
           ├─ sync_operations (idempotency log), review_flags
           └─ audit_logs (append-only)
```

---

## 3. Tables

### 3.1 Foundation (Phase 1) ✅

**companies** — tenant root.
`id, code (unique), name, legal_name, tin, currency (default 'PHP'), timezone (default
'Asia/Manila'), prices_include_tax (default true), settings JSONB, is_active, created_at, updated_at`

**branches** — a physical store.
`id, company_id, code, name, address, phone, tin, receipt_header, receipt_footer, is_active, sync_txid, ...`
Unique `(company_id, code)`.

**stock_locations** — where stock physically sits (store floor, backroom, warehouse).
`id, company_id, branch_id, code, name, location_type ('STORE'|'WAREHOUSE'|'BACKROOM'), is_default, is_active, sync_txid`
Unique `(branch_id, code)`; partial unique index: one `is_default` per branch.
*Why separate from branches?* "Multiple warehouses" and transfers need a place-level identity;
a branch sells from its default location.

**users**
`id, company_id, email (unique, case-insensitive), username (unique per company), full_name,
password_hash (argon2id), pin_hash (argon2id, nullable), pin_offline_salt, pin_offline_verifier,
pin_updated_at, is_active, last_login_at, sync_txid, ...`
The two PIN fields exist for offline login — see [SECURITY.md](SECURITY.md#offline-authentication).

**roles** `id, company_id, code, name, description, is_system` · unique `(company_id, code)`
**role_permissions** `role_id, permission` · PK `(role_id, permission)`
**user_roles** `id, user_id, role_id, branch_id (NULL = all branches)` · unique `(user_id, role_id, branch_id) NULLS NOT DISTINCT`

Permissions are **strings defined in code** (`app/modules/users/permissions.py`), e.g.
`sales.void`, `products.write`. Roles are data (editable per company). Why: code decides what
can be checked; businesses decide who gets what.

**refresh_tokens**
`id, user_id, family_id, token_hash (unique, SHA-256), device_id, expires_at, revoked_at,
replaced_by_id, created_at, created_ip, user_agent`
Rotation with reuse detection — see [SECURITY.md](SECURITY.md#tokens).

**devices** — a registered POS terminal.
`id, company_id, branch_id, terminal_code, name, platform, public_key (PEM, P-256), status
('PENDING'|'ACTIVE'|'REVOKED'), registered_by_id, registered_at, revoked_at, last_seen_at,
last_sync_at, app_version, pull_cursor, sync_txid`
Unique `(branch_id, terminal_code)` among non-revoked devices.

**audit_logs** — append-only.
`id, company_id, branch_id, user_id, device_id, action, entity_type, entity_id, changes JSONB,
metadata JSONB, ip_address, occurred_at, created_at`
Indexes: `(company_id, occurred_at DESC)`, `(entity_type, entity_id)`. A trigger rejects
`UPDATE`/`DELETE`.

### 3.2 Catalog (Phase 2) ✅

| Table | Key columns | Notes |
|---|---|---|
| categories | `parent_id, code, name, sort_order` | Tree via `parent_id`. |
| brands | `name` | |
| units | `code ('PC','BOX','KG'), name, allows_decimal` | |
| tax_rates | `code ('VAT12','VAT_EXEMPT','ZERO'), rate` | |
| price_levels | `code ('RETAIL','WHOLESALE'), is_default` | |
| payment_methods | `code ('CASH','GCASH','MAYA','CARD','BANK_TRANSFER'), kind, requires_reference, opens_drawer` | Synced to POS. |
| products | `name, category_id, brand_id, base_unit_id, tax_rate_id, track_inventory, is_active` | A product is the "concept" (Coke 1.5L). |
| product_variants | `product_id, sku, name, attributes JSONB, average_cost, last_cost, reorder_point, is_default` | The **sellable/stockable** thing. A simple product has exactly one default variant. Why always a variant: sales, stock and barcodes then always point to one table. |
| product_units | `product_id, unit_id, factor NUMERIC(14,6), is_base` | "BOX = 12 × PC". Unique `(product_id, unit_id)`; exactly one base unit (factor 1). Stock is always stored in the base unit. |
| barcodes | `variant_id, product_unit_id, code, symbology, is_primary` | **Unique `(company_id, code)`.** A barcode maps to a variant *and* a unit — scanning the case barcode sells a case. |
| prices | `variant_id, product_unit_id, price_level_id, branch_id (NULL = all), min_quantity, price` | Unique on all but price, `NULLS NOT DISTINCT`. Branch override beats company price; highest `min_quantity ≤ qty` wins (quantity breaks). |

### 3.3 Inventory (ledger/balances/flags ✅ Phase 2; documents ✅ Phase 5) — see [INVENTORY_LEDGER.md](INVENTORY_LEDGER.md)

**inventory_movements** (append-only ledger)
`id, company_id, branch_id, stock_location_id, product_id, variant_id, quantity (> 0, base
units), direction (+1 / −1), signed_quantity (generated), movement_type, reference_type,
reference_id, unit_cost, device_id, user_id, occurred_at, created_at, note`

**inventory_balances** (materialized cache)
`stock_location_id, variant_id (PK), company_id, branch_id, quantity, last_movement_at, updated_at, sync_txid`

**review_flags** — things a manager must look at.
`id, company_id, branch_id, stock_location_id, flag_type ('NEGATIVE_INVENTORY'|'TOTAL_MISMATCH'|'USER_NOT_AUTHORIZED'|'BALANCE_DRIFT'|...),
entity_type, entity_id, details JSONB, occurrences, status ('OPEN'|'RESOLVED'|'DISMISSED'), first_seen_at, last_seen_at, resolved_by_id, resolved_at, resolution_note`
At most one OPEN flag per subject (partial unique index); a repeat occurrence increments
`occurrences` and appends to list values in `details` (e.g. the ids of the sales involved).

Document tables: `stock_adjustments(+_lines)`, `stock_counts(+_lines)` (lines store
`system_quantity` at the moment each line was counted, and `variance` on completion),
`stock_transfers(+_lines)` (`received_base_quantity` per line) — each posts movements
referencing its own id, with deterministic movement ids derived from the line ids.

### 3.4 Sales, payments, cash (Phase 3) ✅

**cash_sessions** (offline-origin; `id` = client UUID)
`id, company_id, branch_id, device_id, opened_by_id, opened_at, opening_float, closed_by_id,
closed_at, counted_cash, expected_cash, over_short, status ('OPEN'|'CLOSED'), sync_txid`

**cash_movements** (offline-origin) `id, cash_session_id, movement_type ('CASH_IN'|'CASH_OUT'|'PICKUP'), amount, reason, user_id, occurred_at`

**sales** (offline-origin)
`id, company_id, branch_id, device_id, cash_session_id, receipt_number, cashier_id, customer_id,
price_level_id, status ('COMPLETED'|'VOIDED'), gross_total, discount_total, tax_total, total,
paid_total, change_total, order_discount (type/value/reason/authorized_by_id), occurred_at,
received_at, voided_at, voided_by_id, void_reason, totals_mismatch, sync_txid`
Unique `(company_id, receipt_number)`. Receipt numbers are generated on the device as
`{BRANCH}-{TERMINAL}-{seq}` so they are unique without a server round-trip.

**sale_items** (offline-origin)
`id, sale_id, line_no, variant_id, product_unit_id, unit_factor, product_name (snapshot), sku,
barcode, quantity, base_quantity, unit_price, gross, line_discount, order_discount_share, net,
tax_rate, tax_amount, total, unit_cost (snapshot for COGS), price_overridden_by_id`
Snapshots (name, price, cost, tax rate) are copied because a receipt must never change when
the product is later renamed or repriced.

**payments** (offline-origin) `id, sale_id, method, amount, tendered, change, reference_no, status, occurred_at, received_at`

### 3.5 Returns (Phase 7) ✅
`returns(id, original_sale_id, branch_id, device_id, cashier_id, authorized_by_id, reason, refund_total, occurred_at)`,
`return_items(id, return_id, sale_item_id, quantity, refund_amount, restock)`,
`refunds(id, return_id, method, amount, reference_no)`.
A return posts `SALE_RETURN` movements for restocked lines. Returned quantity per sale item is
validated against the original minus previous returns.

### 3.6 Purchasing (Phase 6) ✅
`suppliers`, `purchase_orders(po_number, status, supplier_id, branch_id, ...)`,
`purchase_order_lines(quantity, received_quantity, unit_cost)`,
`goods_receipts(purchase_order_id NULL-able, supplier_invoice_no, stock_location_id)`,
`goods_receipt_lines(po_line_id, quantity, base_quantity, unit_cost, expiry_date, lot_no)`.
Posting a receipt writes `PURCHASE` movements and updates `product_variants.average_cost`
(moving weighted average) and `last_cost`.

### 3.7 Customers, promotions, expenses (Phase 7/8) ✅
`customers` (may be created offline → client UUID; phone normalized; synced to terminals),
`promotions` (targets stored as JSONB **on the promotion row** so an edit — including removing a
target — reaches offline terminals as one row update; evaluated locally on the POS; sale items
reference `promotion_id`), `expense_categories`, `expenses` (optionally linked to a drawer cash
movement).

### 3.7b Background jobs ✅
`report_exports` (CSV content stored in the row — fine for small-business volumes) and
`import_jobs` (uploaded CSV + result summary with per-row errors).

### 3.8 Sync (Phase 4) ✅
**sync_operations** — the server-side idempotency log.
`id (= client operation_uuid, PK), company_id, device_id, entity_type, entity_id, operation,
payload_hash, status ('APPLIED'|'REJECTED'), result JSONB, error JSONB, client_created_at, received_at`

### 3.9 Document numbers ✅
`document_sequences(company_id, branch_id, doc_type, prefix, next_value)` — incremented with
`SELECT ... FOR UPDATE` for server-issued numbers (PO numbers, transfer numbers). POS receipt
numbers are device-local instead (offline).

---

## 4. IndexedDB / Dexie schema (per terminal)

Defined in `frontend/lib/db/schema.ts`. Dexie index syntax: `&` unique, `*` multi-entry,
`[a+b]` compound, `++` auto-increment.

| Table | Indexes | Contents |
|---|---|---|
| `meta` | `&key` | device identity, init status, sync cursors, receipt sequence |
| `products` | `id, categoryId, brandId, isActive` | |
| `variants` | `id, productId, sku, *searchTokens` | `searchTokens` = lowercased words of name/SKU for instant search |
| `barcodes` | `id, &code, variantId` | **the scan index** — O(log n) lookup |
| `productUnits` | `id, productId` | |
| `prices` | `id, variantId, [variantId+productUnitId+priceLevelId]` | |
| `categories`, `brands`, `units`, `taxRates`, `priceLevels`, `paymentMethods` | `id` | |
| `inventory` | `[stockLocationId+variantId], variantId` | branch snapshot + local deltas |
| `customers` | `id, phone, *searchTokens` | |
| `staff` | `id, username` | offline login verifiers + permission snapshot |
| `settings` | `&key` | POS & branch settings |
| `sales` | `id, &receiptNumber, cashSessionId, occurredAt, syncStatus` | |
| `saleItems` | `id, saleId` | |
| `payments` | `id, saleId` | |
| `cashSessions` | `id, status` | |
| `cashMovements` | `id, cashSessionId` | |
| `inventoryMovements` | `id, variantId, referenceId` | local provisional movements |
| `heldCarts` | `id, heldAt` | hold / recall |
| `activeCart` | `&id` | crash-safe checkpoint of the cart being built |
| `outbox` | `++seq, &operationId, status, [status+priority+seq]` | pending sync operations |

### Money in IndexedDB
Stored as decimal **strings** (`"125.50"`), exactly as the API sends them. All arithmetic uses
`big.js` in `lib/money`. Never `parseFloat` a money value.

### Transactions
Completing a sale writes `sales`, `saleItems`, `payments`, `inventoryMovements`, `inventory`
and `outbox` in **one Dexie transaction**. If the browser dies halfway, IndexedDB rolls it back
— there is never a sale without its outbox entry or vice versa.

### Schema migrations
Dexie versions (`db.version(n).stores(...).upgrade(tx => ...)`) are the IndexedDB equivalent
of Alembic migrations. Never edit an existing version; add a new one. Upgrades must preserve
unsynced `outbox` rows.
