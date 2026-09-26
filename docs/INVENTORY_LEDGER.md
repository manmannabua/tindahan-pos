# Inventory Ledger

## 1. Principle

> **Inventory movements are the auditable source of truth. Balances are a cache.**

Never `UPDATE products SET stock = 25`. Every change is a new, immutable row in
`inventory_movements`. The current quantity of an item at a location is the sum of its
movements. `inventory_balances` stores that sum so reads are fast.

Why:
- **Audit** — every unit that entered or left is explained (who, when, why, which document).
- **Offline merge** — two terminals' sales are two sets of movements; adding them is always
  correct. Overwriting a stock number is not.
- **Rebuildability** — if the balance table is ever wrong, it can be recomputed from the ledger.
- **Reporting** — inventory at any past date is a `SUM` up to that date.

## 2. Movement record

| Column | Notes |
|---|---|
| `id` | UUID. For offline-origin movements, deterministic (see below) |
| `company_id, branch_id, stock_location_id` | where |
| `product_id, variant_id` | what (always the variant; `product_id` denormalized for reports) |
| `quantity` | **positive**, in the product's **base unit** |
| `direction` | `+1` (in) or `-1` (out) |
| `signed_quantity` | generated column `quantity * direction` — what gets summed |
| `movement_type` | see below |
| `reference_type, reference_id` | the document that caused it (`sale`, `goods_receipt`, `stock_count`…) |
| `unit_cost` | cost per base unit at the time (valuation, COGS) |
| `device_id, user_id` | who/where it originated |
| `occurred_at` | business time (device clock for offline) |
| `created_at` | server insert time |

### Movement types

| Type | Direction | Created by |
|---|---|---|
| `INITIAL_STOCK` | + | opening balances / import |
| `PURCHASE` | + | goods receipt |
| `PURCHASE_RETURN` | − | return to supplier |
| `SALE` | − | sale sync |
| `SALE_RETURN` | + | customer return (restock) |
| `SALE_VOID` | + | voiding a completed sale |
| `TRANSFER_OUT` / `TRANSFER_IN` | − / + | stock transfer send / receive |
| `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` | + / − | manual adjustment with reason |
| `DAMAGED`, `EXPIRED` | − | write-offs |
| `STOCK_COUNT` | ± | count variance posting |

## 3. Immutability

- A PostgreSQL trigger raises an error on `UPDATE` or `DELETE` of `inventory_movements`.
- Mistakes are corrected by a **reversing movement** (e.g. voiding a sale posts `SALE_VOID`
  movements), never by editing.

## 4. Balance maintenance

In the same transaction that inserts movements:

```sql
INSERT INTO inventory_balances (stock_location_id, variant_id, company_id, branch_id, quantity, last_movement_at)
VALUES (...)
ON CONFLICT (stock_location_id, variant_id)
DO UPDATE SET quantity = inventory_balances.quantity + EXCLUDED.quantity,
              last_movement_at = GREATEST(inventory_balances.last_movement_at, EXCLUDED.last_movement_at),
              updated_at = now();
```

- The row lock taken by `ON CONFLICT DO UPDATE` serializes concurrent changes to the same
  item/location, so two simultaneous sales cannot lose an update.
- A nightly Celery task (`inventory.verify_balances`) recomputes `SUM(signed_quantity)` per
  item and flags any drift. `inventory.rebuild_balances` can rebuild from scratch.

## 5. Units

Stock is stored in the **base unit** only. Selling 2 × BOX (factor 12) posts one `SALE`
movement of 24 PC. `sale_items` keeps `quantity=2, unit=BOX, unit_factor=12, base_quantity=24`
for the receipt, and the movement uses `base_quantity`.

## 6. Deterministic movement IDs for sales

The server derives a sale's movement IDs as `uuid5(sale_item_id, "SALE")`. The POS derives its
provisional local movements the same way. So local and server ledgers refer to the same
movement IDs, and re-processing a sale can never create extra movements (PK conflict).

## 7. Multi-terminal offline conflict

```
Stock = 5
POS A offline sells 4        POS B offline sells 3
Both reconnect
Ledger: +5, −4, −3  → balance = −2
```

- Both sales are recorded. Neither is rejected — the goods physically left the store and the
  money was collected.
- Because the balance crossed below zero, a `review_flag` of type `NEGATIVE_INVENTORY` is
  raised for that item/location with the triggering sale ids.
- Managers resolve it (usually with a stock count). The count posts a `STOCK_COUNT` movement;
  the flag is marked resolved.

Financial integrity > pretending the offline stock estimate was current.

### Local inventory on the terminal

`local quantity = last server balance + provisional movements not yet synced`.
The POS warns (does not block, configurable) when selling beyond local stock. After sync and
pull, local provisional movements that the server has confirmed are dropped and the snapshot is
replaced with the server balance.

## 8. Stock counts

1. Count started for a location (optionally a category / list of items).
2. Lines are counted (barcode scanning supported); for each line the system records
   `system_quantity` **at the moment the line is counted**.
3. On completion, each line posts `STOCK_COUNT` with `counted − system_quantity_at_count`.

Recording the system quantity at counting time (rather than at count start or completion)
keeps sales that happen during the count from being mistaken for variance.

## 9. Valuation and COGS

- `product_variants.average_cost` is a moving weighted average, updated on each `PURCHASE`:
  `new_avg = (on_hand × old_avg + received × cost) / (on_hand + received)` (on_hand floored at 0).
- `sale_items.unit_cost` snapshots the average cost when the sale is ingested → COGS is
  `SUM(base_quantity × unit_cost)` with no re-computation needed.
- Inventory valuation = `SUM(balance.quantity × variant.average_cost)`.
