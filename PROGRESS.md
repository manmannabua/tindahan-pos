# PROGRESS

Living status document. **Update at the end of every work session** so a new session can
continue without the previous conversation. Design lives in `docs/`; this file tracks state.

Last updated: 2026-09-26

---

## Completed

### Planning / design (all phases)
- `docs/` — architecture, PostgreSQL + Dexie schemas, offline architecture, sync protocol,
  inventory ledger, barcode scanner, receipts, device management, security/RBAC/offline auth,
  deployment, testing strategy. These define the target for every phase.

### Phase 1 — Foundation ✅
- FastAPI app factory (`backend/app/main.py`), versioned router `/api/v1`, consistent error
  body, request-id + security-header ASGI middleware, CORS allow-list, structlog.
- Settings (`app/core/config.py`) with production safety checks.
- Async SQLAlchemy 2 (asyncpg) for the API; sync engine (psycopg) + `run_async` for Celery.
- Alembic (async env, naming conventions, hand-written triggers via `app/shared/ddl.py`).
- Modules: `auth` (login, refresh rotation + reuse detection, logout, PIN login on device,
  change password, set own PIN), `users` (users, roles, permissions, privilege-escalation guard),
  `companies` (signup seeds roles/branch/location/owner + catalog defaults), `branches`
  (+ stock locations, single default per branch), `devices` (ECDSA P-256 registration,
  challenge–response device tokens, revoke), `audit` (append-only, keyset pagination), `health`.
- RBAC: permission catalogue in code (`users/permissions.py`), default role templates, branch-
  scoped assignments, `require_permission` dependency + `principal.require(perm, branch_id)`.
- Redis: rate limiting (fail-open), device challenge nonces; `REDIS_URL=fakeredis://` for dev.
- Celery app + beat schedule; tasks: purge expired refresh tokens, verify inventory balances.
- CLI: `python -m app.cli seed-dev` (DEMO company + staff with PINs), `create-company`.
- Docker: `backend/Dockerfile`, `docker-compose.yml` (dev), `docker-compose.prod.yml`,
  `infra/nginx/pos.conf`, `infra/.env.prod.example`.

### Phase 2 — Product & Inventory ✅ (backend)
- Reference data: categories (tree, cycle check), brands, units, tax rates (VAT12 / exempt /
  zero-rated, one default), price levels (RETAIL default, WHOLESALE).
- Products: variants (always ≥1, one default), product units with conversion factors (one base
  unit), barcodes (canonical storage, one row per code forever, reassignment reuses the row,
  internal EAN-13 generation with prefix 2), prices (per unit / level / branch / qty break;
  replace-list API that updates in place and deactivates missing rows).
- Price resolver (pure function, `pricing/resolver.py`) — to be mirrored in TS with shared vectors.
- Inventory ledger: append-only `inventory_movements` (trigger), `signed_quantity` generated
  column, `inventory_balances` upserted in the same transaction in sorted key order (deadlock
  avoidance), idempotent by movement id, NEGATIVE_INVENTORY review flags (one open flag per
  subject, occurrences + merged references). Initial stock endpoint. Balance/movement queries
  with low-stock/negative filters. `verify_balances` + nightly task.
- Review flags module (list/resolve).
- Cost visibility: variant costs hidden unless `products.write` or `reports.financial`.

### Phase 1 frontend ✅ (`frontend/`, see frontend/README.md)
- Next.js 16.3 (Turbopack) + React 19.2, Tailwind 4, shadcn/ui (`base-nova` style = Base UI,
  no `asChild`; forms use `Field` + RHF `Controller`), TanStack Query 5, Zustand 5, RHF + Zod 4,
  Dexie 4 (schema v1 in `lib/db/schema.ts`), big.js money (`lib/money`), Serwist PWA via
  `@serwist/turbopack` (esbuild-wasm), Vitest + RTL + fake-indexeddb, Playwright.
- API client with in-memory access token, single-flight refresh, `ApiError`; session restore.
- Admin: login/signup, shell with permission-gated nav, dashboard placeholder, branches +
  locations, users (roles, PIN, password, deactivate), roles (permission picker), devices
  (revoke w/ warning), audit log, company settings.
- POS: static `/pos`, `/pos/setup`, `/pos/login` shells; connectivity monitor + status badge;
  scanner test panel. `lib/barcode` (normalize/candidates/symbology/detector) + hook.
- `types/api.ts` (hand-written, Phase 1) + `types/openapi.d.ts` (`pnpm gen:api`) +
  `types/api-contract.ts` (typecheck fails if the two drift).
- Checks: lint ✓ typecheck ✓ 73 Vitest tests ✓ build ✓ 3 Playwright e2e ✓ (`PW_CHANNEL=chrome`).

### Phase 3/4 frontend ✅ — the offline POS engine (`frontend/`)
- Dexie schema v1 (matches pull shapes; **from now on schema changes need a new version**),
  `lib/money/sale-calculation.ts` (passes the shared vectors), price resolver mirror,
  non-extractable P-256 device key + device-token client, `/pos/setup` wizard (register →
  resumable paged download with per-table counts → validate → persistent storage → READY),
  offline PIN login (PBKDF2 verifier, 5-try lockout, 7-day validity) + manager approval dialog,
  cash sessions (open/in/out/pickup/close, over/short, printable summary), sell screen (scan
  box + timing detector, search, qty/price/discount edits with approval, order discount,
  hold/recall, crash-safe cart), payments (cash quick tender, e-wallet/card/bank with
  reference, split), `completeSale` = one Dexie transaction (sale, items, payments,
  provisional movements with backend-identical derived ids, stock, outbox, receipt seq),
  58/80 mm receipts via hidden iframe + reprint, sync engine (all statuses, backoff reset on
  reconnect, Web Locks, pull + reconciliation), sync monitor view.
- `/pos` is a single page with in-memory views (PIN login, sell, cash, sales, sync) — a route
  change would drop the in-memory cashier session. The focused scan box owns Enter; the
  keystroke-timing detector only runs when focus is elsewhere (a 50 ms gap split one scan in
  e2e).
- **Playwright critical test passes**: setup via UI → PIN → cash session → API blocked → 20
  scanned sales (cash, GCash, split) → reload → reconnect → server has exactly 20 sales,
  receipts 000001–000020, payments = totals, stock correct, second sync adds nothing.
  **Two-terminal oversell e2e passes** (balance −2, one NEGATIVE_INVENTORY flag).
- Checks: lint ✓ typecheck ✓ 142 Vitest ✓ build ✓ 5/5 Playwright ✓ (`PW_CHANNEL=chrome`,
  backend with `RATE_LIMIT_ENABLED=false` because each run signs up companies).

### Phase 3/4 backend ✅ (sales, payments, cash sessions, sync)
- Tables: `payment_methods` (seeded CASH/GCASH/MAYA/CARD/BANK_TRANSFER), `cash_sessions`,
  `cash_movements`, `sales`, `sale_items`, `payments`, `sync_operations`.
- `modules/sales/calculation.py`: discounts, order-discount allocation, VAT incl./excl., tax
  breakdown, split payment settlement. **Contract** with the POS via
  `shared/test-vectors/sale_calculation.json` (regenerate: `uv run python scripts/gen_sale_vectors.py`).
- `POST /api/v1/sync/push` (device token): per-op transaction, idempotency via
  `sync_operations` PK + entity-level dedupe (same entity + op + payload hash → DUPLICATE,
  different payload → CONFLICT), statuses APPLIED/DUPLICATE/DEFERRED/REJECTED/CONFLICT/RETRY,
  REJECTED/CONFLICT remembered. Handlers: `cash_session.open`, `cash_session.close` (server
  expected cash, CASH_SESSION_MISMATCH flag), `cash_movement.record`, `sale.complete` (items,
  payments, deterministic SALE movements, server recompute → TOTAL_MISMATCH flag, permission
  re-validation → USER_NOT_AUTHORIZED flag, unit cost snapshot). Device status + CLOCK_SKEW.
- `GET /api/v1/sync/pull`: window `[lo, hi)` on `sync_txid` with `hi` = xmin horizon, keyset
  pages across 15 tables, device/branch scoping, `counts` on first page of a full download,
  full `staff` snapshot (verifiers only for users with pos.access in the branch).
- `GET /api/v1/sync/context`: company/branch/locations, receipt prefix and last receipt seq
  (replacement terminals continue numbering).
- Tests: `tests/integration/test_sync_push.py` (20-sale day exactly once + full resend,
  rebuilt outbox, deferral, rejection memory, total mismatch, two-terminal oversell, split
  payment + pickup + close, deactivated cashier, receipt continuity, revoked device) and
  `tests/committed/` (real commits: complete paginated download, incremental pull, branch
  scoping, staff snapshot, **4 concurrent pushes of the same batch → exactly once**).

### Phase 5 backend ✅ — inventory operations (`inventory/operations.py`)
- Adjustments (ADJUSTMENT_IN/OUT, DAMAGED, EXPIRED; any unit → base units; by variant or
  barcode), stock counts (scan-to-count ADD/SET, system qty captured **at counting time**,
  full counts zero uncounted items, STOCK_COUNT movements), transfers (DRAFT → send =
  TRANSFER_OUT → receive = TRANSFER_IN with shortages flagged TRANSFER_DISCREPANCY; cancel in
  transit returns goods). Document numbers ADJ-/CNT-/TRF- via `document_sequences`.

### Phase 6 backend ✅ — purchasing
- Suppliers; purchase orders (DRAFT → APPROVED → PARTIALLY_RECEIVED/RECEIVED, cancel, close
  short); goods receipts (from PO lines or direct), over-receipt refused, PURCHASE movements,
  **moving weighted average cost** (company-wide per variant, on-hand floored at 0) + last cost.
  `require_any_permission` dependency added.

### Phase 7 backend ✅ — customers, voids, returns, promotions
- Customers (offline-creatable via `customer.upsert`, phone normalization, DUPLICATE_CUSTOMER
  flag; synced to terminals). Sales reference customers (DEFERRED until the customer arrives).
- Voids (`sale.void` op + `POST /sales/{id}/void`): SALE_VOID movements, payments voided,
  allowed if the void **occurred** before the shift closed; not after returns.
- Returns (`return.create` op + `POST /returns`): pro-rata refunds of what was paid, last units
  refund the exact remainder (no rounding drift), over-return refused, optional restock
  (SALE_RETURN), cash refunds reduce the drawer's expected cash.
- Promotions (definitions + JSONB targets, synced to terminals; evaluated on the POS; sale
  items carry `promotion_id`). Domain refusals in sync → REJECTED with the domain error code.

### Phase 8 backend ✅ — reports, dashboard, expenses, monitoring, realtime
- Expenses + categories (seeded). Reports (`/reports`, 23 reports incl. summary, trend,
  by hour/product/category/brand/cashier/branch/payment method, best sellers, slow movers,
  no sales, valuation, low/out/negative stock, movements, count variance, purchases by
  supplier, cash drawer over/short, expenses, returns, voids). Company-timezone periods,
  PostgreSQL aggregation, cost fields hidden without `reports.financial`, 60 s Redis cache,
  CSV export jobs (Celery task `reports.export`, or in-process with `BACKGROUND_JOBS_INLINE`).
- `/dashboard` (today vs yesterday, 7-day trend, top products, stock alerts, open flags,
  device health), `/sync/monitor` (device presence/staleness, REJECTED/CONFLICT ops).
- Realtime WebSocket `/api/v1/ws` (first-message auth, Redis pub/sub `rt:{company}`),
  `sync.applied` events after commit, device presence keys. Optional by design.

**Backend checks:** see "Current checks" below.

### Phase 7 POS ✅ (`frontend/`)
- `lib/promotions/evaluate.ts` (passes `shared/test-vectors/promotions.json`), promotions applied
  as AMOUNT line discounts with `promotion_id`, removable per line; customer picker + offline
  create (`customer.upsert`), customer price level; voids (open shift only, approval) and returns
  (pro-rata refunds, restock toggle, `R` numbering) with **Dexie schema v2** (`returns`,
  `returnItems`, `refunds`); camera scanning (BarcodeDetector / lazy @zxing/browser); manager-
  gated terminal settings (receipt width, auto-print, sounds, stock warning, scanner timing);
  "Update available" prompt applied only with an empty cart.

### Admin portal ✅ (Phases 2, 5–9 UI)
- Catalog (products, variants, units, barcodes, price tiers, reference data), barcode labels
  (38x25, 50x30 mm, A4 3x8), CSV import/export; inventory (balances, ledger, adjustments,
  initial stock, scan-to-count, transfers); purchasing (suppliers, POs, receiving, receipts);
  customers, promotions, sales (void, returns); dashboard (WebSocket refresh, 60 s poll
  fallback), 23 reports with charts + CSV export, expenses, review flags, sync monitor.
  Deps: recharts, jsbarcode. `types/api-admin.ts` derives from generated `types/openapi.d.ts`.

### Phase 9 hardening ✅ (backend/infra)
- pg_trgm search indexes; per-user/per-device API rate limit; audit of offline voids/returns;
  permission cache per push (35 → 50 sales/s); nightly jobs (refresh-token purge, ledger/balance
  verification, job payload purge); `scripts/benchmark_sync.py`; backup/restore scripts;
  frontend Dockerfile (dev + standalone runtime); nginx rules for `/serwist/`.

### Philippine compliance & printing ✅
- **Senior citizen / PWD discount** (RA 9994 / RA 10754): VAT exemption + 20% on eligible lines
  (`products.sc_pwd_eligible`), no stacking, holder details on sale + receipt, part of the shared
  calculation contract (6 new vectors). Non-eligible statutory lines → `STATUTORY_DISCOUNT_REVIEW`.
  Reports: `sc-pwd-book`, SC/PWD discounts and VAT exemptions in the sales summary.
- **BIR fields**: company VAT/NON-VAT registration + accreditation no.; terminal MIN, serial,
  PTU (admin device edit → delivered via `/sync/context`); BIR receipt header; server
  `terminal-reading` (X/Z) report and POS X/Z readings from local data with a non-resettable
  grand-total counter (Dexie v3).
- **Cross-terminal returns**: `GET /sync/sales/lookup` (device token) with returned quantities and
  exact refunded amounts; POS looks up locally first, then online.
- **ESC/POS printing** (WebUSB / WebSerial) with drawer kick on cash payments, test print, falls
  back to browser printing. Untested on real hardware.
- Dev DB `pos` was reset (DEMO only).

### Admin UI polish ✅
- **Product photos**: `PUT/DELETE /products/{id}/image` (JPEG/PNG/WebP by magic bytes, ≤ 2 MB,
  `products.write`), stored on disk under `MEDIA_ROOT` (prod: `media` volume, included in
  `backup.sh`), served at `/api/v1/media/...` with unique filenames per upload. The browser resizes
  to ≤ 800 px WebP before uploading. Thumbnails in the products table; editor on the product page.
  Photos are not auth-protected (unguessable URLs) and are not cached offline by the service worker.
- **Currency input** (`components/shared/currency-input.tsx`): ₱ prefix, live thousands
  separators, rejects letters, caret-stable, pads decimals on blur; used for all money fields
  (costs keep 4 decimals).
- **Light/dark toggle** (next-themes) in admin and POS headers; sidebar logo and "Open POS
  terminal" stay fixed, the nav scrolls with a scrollbar shown only on hover.

### Online catalog ✅ (docs/ONLINE_CATALOG.md)
- Public, browse-only store page `/s/<link-name>` (not e-commerce): search, categories, branch
  picker, in-stock filter, product details, price, availability ("Stock updated N min ago"),
  contact links. Server-rendered first view; refreshes stock every 60 s while visible.
- Owner: *Catalog → Online catalog* (enable, link name, branches, stock display
  AVAILABILITY/QUANTITY/HIDDEN, low-stock threshold, prices on/off, search-engine indexing
  (default off), contact info, copy link, printable QR sign). Products are hidden by default
  (`products.show_online`); product switch, bulk show/hide (selected rows or all matching the
  filter), Online filter + badge, CSV `show_online` column.
- Backend module `storefront/` (admin + anonymous public router); explicit public schemas with
  pinned field sets (no cost/SKU/barcode leaks); 404 for unknown/disabled/unpublished; stock =
  store + backroom locations of the branch, negatives shown as out; Redis 30 s cache with
  per-company version bump on owner changes; per-IP rate limit. Nginx: `public` rate-limit zone
  and 10 s micro-cache for `/api/v1/public/`, credentials stripped.
- The POS service worker is not registered on `/s/` pages.

### Receipt journal ("virtual receipts") ✅ (docs/RECEIPT_PRINTING.md §5)
- Every receipt (sales and return slips) is stored exactly as issued — printed or not — in the
  terminal's journal (Dexie v4, same transaction as the sale), with print state and count, and
  synced (`receipt.issue`, `receipt.print`) to append-only `receipts` / `receipt_prints` tables.
- POS → *Receipts*: offline list, "Not printed" / "Returns" filters, on-screen receipt (same
  32/48-column layout + barcode), Print / Reprint from the stored copy. Admin → *Sales →
  Receipts* (filters: dates, branch, printed, type) with viewer + print history; *View receipt*
  on sale detail. Older local sales get `reconstructed` entries on first open.
- Prints trigger an immediate sync. Online catalog: measured units show their symbol
  ("₱52.00 / kg", "100 kg left"; `unit_symbol` in the public API).

### Optional features + onboarding ✅ (docs/FEATURES_AND_ONBOARDING.md)
- 12 owner-switchable features (stock, purchasing, customers, promotions, manual discounts,
  returns, cash drawer, expenses, SC/PWD, BIR, online catalog, receipt journal screens) with
  dependencies and presets (Basic / Standard / Everything). `companies.features` (missing = on),
  `PUT /companies/current/features` (owners, audited), `require_feature` on routers/routes/
  reports → `403 feature.disabled`; sync never gated. Public catalog 404 when off; no stock
  shown online without stock tracking.
- Admin: Settings → Features, sidebar + route guard ("X is turned off"), in-page gating.
  POS: features via `/sync/context` → IndexedDB, read live (`usePosFeature`): Customer /
  Discount / Senior-PWD buttons, Cash tab (no session required when off; a Readings tab for
  BIR), returns, Receipts tab, promotions, stock warning.
- Onboarding wizard for new sign-ups (business → store → features → next steps); existing
  companies were marked onboarded by migration `8f9e3d20bc71`.

### Hardening round ✅
- Sign-in: a refresh token reused within the 15 s grace window (reload aborted the refresh
  response) now rotates the newest token of its family instead of returning 401; reuse after the
  window still revokes the family (theft).
- Built-in Store Manager role gets `settings.manage` (terminal settings at the counter);
  migration `5ca76ecbb3e4` adds it to existing system Manager roles.
- Onboarding asks "VAT-registered?" explicitly (no default); non-VAT makes VAT Exempt the
  default tax rate for new products.
- Plain-language messages for session/terminal/sync/setup error codes; POS printer setting
  explains the browser print dialog pause and `--kiosk-printing`.
- New store-front app icons (`frontend/scripts/generate-icons.py`).
- Dev DB reset: DEMO company (onboarded, all features on, 8 products, online catalog
  `demo-mini-mart` published); `seed-dev` now marks the demo as onboarded.

**Current checks (all green):** backend `pytest` 173 · ruff · mypy strict. Frontend lint ·
typecheck · 264 Vitest · build · **11/11 Playwright**.

## Live demo
**https://tindahan.for-demo.online** on `shared-lemp-vm` (native systemd, no Docker) since
2026-09-26 — see `infra/deploy/shared-lemp/README.md`. Verified live: HTTPS, admin sign-in,
terminal setup, service worker precache, **offline reload + offline sale → synced once**,
public catalog `/s/demo-mini-mart` with the Nginx micro-cache (MISS→HIT), Celery with real
Redis (db 3). Footprint: API ~220 MB, worker ~140 MB, web ~75 MB; 3 PostgreSQL connections.
Demo logins (random passwords) in `/root/tindahan-demo.txt` on the VM. Upgrade:
`package-release.sh` → `gcloud compute scp` → `sudo bash install.sh`.

## Next (suggested)
1. Install the PWA on a real tablet with a USB scanner + thermal printer against the live demo;
   `docker-compose.prod.yml` itself is still untested (the demo runs natively).
2. Test ESC/POS printing + drawer kick on real printers; per-item stock page for deep links.
3. PH-specific leftovers: senior-citizen 5% discount on basic necessities (DTI/DA rules), BIR
   accreditation itself (a formal process, not code).
4. SKU toggle on labels; a dashboard "getting started" checklist for new businesses.
5. Online catalog extras: promo badges, store subdomains, "ask about this item" via Messenger,
   visit statistics (docs/ONLINE_CATALOG.md §5).
6. Multi-item promotion bundles (needs a new evaluator version + vectors on both sides).
7. `.xlsx` import/export (CSV UTF-8 works with Excel today).
8. Future analytics/AI modules reading the ledger (see ARCHITECTURE.md §7).
## Architectural decisions (summary — details in docs/ARCHITECTURE.md §2)
- Modular monolith; route → service → repository; service owns the single commit.
- Async API (asyncpg); `lazy="raise"` relationships; never touch expired attributes in async.
- UUIDv7 everywhere; offline-origin records use the client UUID as PK (idempotency by PK).
- `sync_txid` (writing transaction id, set by trigger) as the pull cursor, filtered by
  `pg_snapshot_xmin` — not `updated_at` (which can skip rows).
- Money `NUMERIC(14,2)`, unit cost `NUMERIC(14,4)`, qty `NUMERIC(14,3)`, unit factor
  `NUMERIC(14,6)`; big.js + decimal strings on the client.
- Barcodes stored canonically (UPC-A → EAN-13); check digits informative, not enforced.
- Inventory: ledger is truth, balances are cache, never reject a sale for stock; flag instead.
- Device identity = non-extractable WebCrypto ECDSA key; device token authorizes sync and PIN
  login; offline PIN via PBKDF2 verifier synced to branch devices (threat model in SECURITY.md).
- Refresh tokens: opaque, hashed, httpOnly cookie per client (`rt_admin`, `rt_pos`), rotation
  with family revocation on reuse (15 s grace for concurrent-tab races).
- Permissions are code, roles are data; can only grant permissions you hold.

## Known issues / environment notes
- This dev machine (Windows) has **Smart App Control**: unsigned executables are blocked
  (uv-managed Python, `.venv\Scripts\pytest.exe`, mypy's compiled wheel). Workarounds in use:
  Python 3.13 from python.org via winget; run tools as `python -m <tool>`; mypy installed from
  source (`UV_NO_BINARY_PACKAGE=mypy`). `uv` itself is run as `python -m uv`.
- No Redis/Docker on this machine: `.env` uses `REDIS_URL=fakeredis://`. Celery worker/beat
  cannot run here until Redis (or Memurai) is installed; tasks are tested by direct calls.
- PostgreSQL 17 runs as a Windows service; superuser `postgres`/`postgres` (dev only);
  app role `pos`/`pos`; databases `pos` (dev) and `pos_test` (tests drop/recreate schema).
- Port 8000 on this machine is currently taken by another project (a Laravel dev server from
  `D:/dev/booking-system`). This session ran the POS backend on **8010**: start the web app with
  `API_ORIGIN=http://localhost:8010` and e2e with `E2E_API_URL=http://localhost:8010/api/v1`.
- `verify_balances` detects balance≠ledger drift but not ledger rows lacking a balance row
  (would need a full outer join) — low risk because both are written in one transaction.
- The spec's example barcode `4800361419117` has an invalid EAN-13 check digit; it is accepted
  as a generic code (documented in BARCODE_SCANNER.md).
- Enum-typed columns are stored as VARCHAR + CHECK and come back from the DB as plain `str`
  (not the StrEnum): compare with `==`, never call `.value` on an ORM attribute.
- `tests/committed/` commits real rows into `pos_test` (schema is dropped at the next session
  start). Tests in `integration/` must scope global counts/queries by company.
- Frontend: service worker registers only in production builds (the POS shows "Update
  available — reload when idle"); Playwright uses installed Chrome (`PW_CHANNEL=chrome`) because
  Smart App Control blocks the downloaded Chromium.
- Dev DB `pos` was reset on 2026-09-26 (DEMO only); e2e runs add `E2E…`/`ADM…` companies again.
  e2e runs need the backend started with `RATE_LIMIT_ENABLED=false`.
- Offline, POS returns work only against sales stored on that terminal; online they can use
  any terminal's sale via `/sync/sales/lookup`.
- Serwist uses native esbuild (esbuild-wasm failed on Windows paths); it currently runs under
  Smart App Control.
- Playwright must run against `next dev`: in a production build the service worker fetches
  API calls itself, bypassing Playwright's `page.route` offline blocking.
- Repo: git@github.com:manmannabua/tindahan-pos.git (branch `main`).
- Windows: killing a `uvicorn --reload` process can orphan its worker child, which keeps
  serving port 8000 with old code/settings (check `netstat -ano | findstr :8000`). The dev
  machine's `backend/.env` sets `RATE_LIMIT_ENABLED=false` so e2e runs can sign up companies.
- Manual walkthroughs against running dev servers: `frontend/scripts/manual-walkthrough.mjs`
  (admin) and `manual-walkthrough-pos.mjs` (terminal setup → online/offline/SC sales → reload →
  sync → server check; `TERMINAL=T02` for a second terminal). Screenshots per step.

## Pending migrations
- None pending. Latest: `5ca76ecbb3e4` managers manage terminal settings (before it: `8f9e3d20bc71` company features + onboarding, `fbaf8685d085` receipt journal, `5f5a4551ceb3` storefronts + `products.show_online`, `e1c3cb7b756c` SC/PWD discount + BIR fields, `ff379da3c120` import jobs + trigram search). Revisions (in order): `ef8f6c10c69c` foundation, `1e3cfbdadecb` catalog and
  inventory ledger, `43cc34f6bf79` sales/payments/cash sessions/sync, `311a2c40e3d3` inventory
  documents, `34f69fa13fd1` suppliers and purchasing, `428f5d187452` customers/returns/
  promotions, `c5a1c4ea7bf5` expenses and report exports. Run `uv run alembic upgrade head`.

## Demo data
`python -m app.cli seed-dev` → company `DEMO`, admin `owner@demo.example.com` /
`demo-password-123`; staff `manager` (PIN 246810), `cashier1` (135790), `cashier2` (975310),
`stock` (864209), all with password `demo-password-123`.
