# Online catalog (public store page)

A store owner can publish a **browse-only** public page — `https://<host>/s/<link-name>` — where
customers search the products the owner chose to show and see price and availability. It is
deliberately **not e-commerce**: no cart, checkout, customer accounts or payments. At most it
shows how to reach the store (address, phone, Messenger link, hours).

## 1. What the owner controls

| Level | Setting | Default | Why |
|---|---|---|---|
| Store (`storefronts` row) | `enabled` | off | Nothing is public until the owner turns it on. |
| | `slug` (link name) | company code | Unique across all companies; `a-z0-9-`, 3–48 chars. |
| | `branch_ids` | all active branches | Stock and prices are per branch; the first is the default. |
| | `stock_display` | `AVAILABILITY` | In/Low/Out hides exact counts from competitors. `QUANTITY` and `HIDDEN` are opt-in. |
| | `low_stock_threshold` | 5 | "Low stock" at or below this quantity (base units). |
| | `show_prices` | on | |
| | `allow_indexing` | **off** | Only people with the link/QR find it unless the owner opts in to search engines. |
| | `about`, `phone`, `messenger_url`, `hours` | empty | `messenger_url` must be `https://` (it is rendered as a link). |
| Product | `products.show_online` | **off** | Opt-in per product so nothing is published by accident. |

Owners set products online one at a time (product page switch), in bulk (tick rows → *Show
online*), for everything matching the current product-list filter (*Online* menu), or through the
CSV import column `show_online` (blank = unchanged; new products stay hidden).

Permissions: catalog settings need `company.manage`; showing/hiding products needs
`products.write`. All changes are audited (`storefront.updated`, `product.updated`,
`product.show_online_changed`).

## 2. Public API — `GET /api/v1/public/stores/{slug}[/products[/{id}]]`

- **Anonymous and read-only.** No token, no cookies (Nginx strips both for this path).
- **One answer for "not there".** Unknown slug, disabled catalog, inactive company, unpublished
  or inactive product and another company's product all return `404` — outsiders cannot probe
  which stores or products exist.
- **Explicit public schemas** (`storefront/schemas.py` → `Public*`). They never extend the
  internal product schemas, and `tests/integration/test_storefront_public.py` pins the exact field
  sets, so cost, SKU, barcode, supplier or reorder point can never leak by being added to a
  shared model.
- **Search**: name or brand, `ILIKE` with wildcards escaped; category filter includes
  sub-categories; `in_stock` filter; `limit ≤ 48`.

### Stock and "real-time"

Availability comes from `inventory_balances` (the cache of the append-only ledger) for the chosen
branch, summed over **sellable locations: store floor and backroom** (warehouses are excluded —
walk-in customers can't buy from them). Negative balances, which offline-first selling allows,
show as *Out of stock* and never as a negative number. Products that don't track inventory are
always *In stock*.

The server only knows about a sale once the terminal has synced it. Each branch reports
`synced_at` (its most recent terminal sync) and the page shows "Stock updated N min ago". With
terminals online that is seconds; an offline terminal's sales appear when it reconnects.

### Prices

Default price level, base unit, quantity 1, resolved with the same rules as the POS
(`pricing/resolver.py`): a branch-specific price beats the company-wide one. A product card
shows the lowest variant price ("from ₱…" when variants differ).

## 3. Load protection (why the POS is never slowed down by shoppers)

1. **Redis response cache, 30 s** per store + query (`storefront/cache.py`). Keys carry a
   per-company version that is bumped when the owner changes settings or publishes/unpublishes,
   so those changes show immediately; stock changes simply age out. Redis failures fall back to
   computing the response (Redis is never the source of truth).
2. **Nginx micro-cache, 10 s** for `/api/v1/public/` (`infra/nginx/pos.conf`), with
   `proxy_cache_lock` so a burst of identical requests costs one upstream call.
3. **Rate limits**: Nginx `public` zone (10 r/s per IP, burst 40) for `/s/` and the public API,
   plus 300 requests/min per IP in the app.
4. The page refreshes stock every 60 s only while it is visible (TanStack Query
   `refetchInterval`, paused in background tabs) — polling, not WebSockets: an open socket per
   anonymous shopper buys little and is much harder to protect.

Worst case, stock shown online lags the server by ~40 s (Nginx 10 s + Redis 30 s).

## 4. Frontend

- `app/(public)/s/[slug]/page.tsx` renders the first view **on the server** (fast first paint on
  phones, indexable when allowed). It calls the API directly (`API_ORIGIN`) and forwards the
  shopper's IP from Nginx's `X-Real-IP`, so the app's per-IP limit applies to the shopper, not to
  the web server. `robots` meta follows `allow_indexing`.
- `features/storefront/components/store-catalog.tsx` takes over in the browser: debounced
  search, branch picker, category chips, in-stock toggle, paging, product detail dialog. The
  query lives in the URL (`?q=&category=&branch=&stock=1&page=`) so searches can be shared.
- The public page uses only `features/storefront/public-api.ts` + `types/api-public.ts` — never
  the authenticated admin API client.
- **The POS service worker is not registered on `/s/…`** (`ServiceWorkerRegistration`):
  shoppers must not download the multi-megabyte POS app shell.
- Owner side: *Catalog → Online catalog* (settings, link, QR code for a counter sign — generated
  in the browser with the already-bundled `@zxing/browser` encoder); *Products* (Online filter,
  row selection, bulk actions, badge).

## 5. Not included (possible later)

Promo badges from active promotions; a store subdomain; a "Reserve / ask about this item" button
that opens Messenger with the product name; visit statistics for the owner.
