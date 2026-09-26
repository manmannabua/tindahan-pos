# System Architecture

This document is the map of the whole system. Each section explains **what** was chosen and
**why**, because the "why" is what lets you extend the system without breaking its guarantees.

> The single most important rule: **the FastAPI server can disappear for an hour and a
> properly initialized POS terminal must still serve customers.** When the server returns,
> every legitimate transaction must synchronize exactly once.

Everything below is shaped by that rule.

---

## 1. High-level topology

```
                    ┌──────────────────────────┐
                    │       PostgreSQL         │  source of truth (financial + ledger)
                    └────────────┬─────────────┘
                                 │ SQLAlchemy 2 (asyncpg)
                    ┌────────────▼─────────────┐
                    │         FastAPI          │  auth, business rules, sync, reports
                    └───────┬──────────┬───────┘
                            │          │
                 ┌──────────▼──┐   ┌───▼──────────────┐
                 │    Redis    │◄──┤  Celery workers  │  reports, imports, recalcs
                 │ cache/locks │   │  + Celery beat   │
                 │ queue/pubsub│   └──────────────────┘
                 └─────────────┘
                            ▲  HTTPS (/api/v1/...)  +  optional WebSocket
            ┌───────────────┴────────────────┐
   ┌────────┴─────────┐              ┌───────┴──────────┐
   │ POS terminal 1   │              │ POS terminal 2   │
   │ Next.js PWA      │              │ Next.js PWA      │
   │ React + Zustand  │              │ React + Zustand  │
   │ Dexie/IndexedDB  │              │ Dexie/IndexedDB  │  ← operational local DB
   │ Service worker   │              │ Service worker   │  ← caches the app shell only
   └──────────────────┘              └──────────────────┘
```

Two very different kinds of client live in the same Next.js app:

| Surface | Route | Data source | Works offline? |
|---|---|---|---|
| **Admin portal** | `/(admin)/...` | FastAPI via TanStack Query | No (shows an offline notice) |
| **POS terminal** | `/pos/...` | IndexedDB via Dexie; FastAPI only through the sync engine | **Yes** |

The POS never calls FastAPI in the checkout path. Barcode → IndexedDB → cart → local sale →
outbox. The sync engine moves data between IndexedDB and FastAPI in the background.

---

## 2. Key decisions (ADR summary)

Each decision is written as *decision → reason*. Longer rationale lives in the topic docs.

### 2.1 Backend

| # | Decision | Why |
|---|---|---|
| B1 | **FastAPI + Pydantic v2** | Typed request/response validation, automatic OpenAPI, dependency injection that fits RBAC well. |
| B2 | **Async request handling with SQLAlchemy 2 async + asyncpg** | The API is I/O-bound (DB, Redis, WebSockets). Async lets one worker hold many idle sync/WebSocket connections cheaply. We do *not* make CPU work async: heavy work goes to Celery. |
| B3 | **`lazy="raise"` on relationships** | Async SQLAlchemy cannot lazy-load implicitly. Raising forces explicit `selectinload()`, which also prevents N+1 queries. |
| B4 | **Celery tasks are sync; they reuse async services via `run_async`** | Celery is a synchronous task system. Simple tasks use a sync session (psycopg 3). Tasks that need existing async service logic run it in a fresh event loop with a task-scoped `NullPool` engine, so business rules are never written twice. |
| B5 | **Modular monolith** (`app/modules/<domain>`) | One deployable, one database, clear domain boundaries. Microservices would add network failure modes without benefit at small-business scale. Modules can be extracted later if ever needed. |
| B6 | **Route → Service → Repository** layering | Routes only translate HTTP ↔ service calls. Services hold business rules and own the transaction. Repositories hold non-trivial queries. This keeps rules testable without HTTP. |
| B7 | **Service owns the transaction (unit of work)** | A sale, its items, payments and inventory movements must commit together or not at all. The service calls `session.commit()` once; repositories never commit. |
| B8 | **UUIDv7 primary keys everywhere** | Records created offline need IDs before the server sees them. UUIDv7 is time-ordered, so B-tree inserts stay local (unlike random UUIDv4). Server-created rows use the same scheme for consistency. |
| B9 | **Client-generated UUID *is* the primary key** for offline-origin records (`sales.id` = `sale_uuid`) | Idempotency falls out of the primary key constraint: a retried sale cannot be inserted twice. See [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md). |
| B10 | **`NUMERIC` for money and quantity, `Decimal` in Python** | Floats cannot represent 0.10 exactly. Money is `NUMERIC(14,2)`, unit costs `NUMERIC(14,4)`, quantities `NUMERIC(14,3)`. |
| B11 | **Immutable inventory ledger + materialized balance** | Movements are auditable history; balances are a cache for speed. See [INVENTORY_LEDGER.md](INVENTORY_LEDGER.md). |
| B12 | **Celery + Redis broker** | Mature, has scheduling (beat), retries, monitoring (Flower), and is well-documented. Alternatives (arq, Dramatiq, Taskiq) are fine but Celery has the widest operational knowledge base. Checkout never depends on it. |
| B13 | **Redis is never a source of truth** | Redis holds caches, rate-limit counters, locks, device presence, short-lived challenges and pub/sub. If Redis is flushed, nothing financial is lost. |
| B14 | **Multi-tenancy by `company_id` column** | Each business is a company; every tenant table carries `company_id` and every query is scoped by the authenticated principal. PostgreSQL Row-Level Security can be added later as defense in depth. |
| B15 | **uv for Python dependency management** | Fast, lockfile-based, manages the virtualenv. `pyproject.toml` is the single config file for ruff, mypy and pytest. |

### 2.2 Frontend

| # | Decision | Why |
|---|---|---|
| F1 | **Next.js App Router** for shell, routing, admin, auth UI | Layouts, route groups `(auth)`/`(admin)`, and server rendering where it helps (public pages later). |
| F2 | **POS is a static, client-only route** | `/pos` is pre-rendered at build time and contains no server data. The service worker precaches it, so it opens with no network. Server rendering would make the POS depend on the server. |
| F3 | **Dexie over raw IndexedDB** | Typed tables, compound indexes, transactions and `liveQuery` (reactive queries) with a tiny API. |
| F4 | **Three kinds of state, three tools** | TanStack Query = server state (admin data). Zustand = UI/session state (active cart, terminal status). Dexie = durable offline business data. Never mirror all server data into Zustand. |
| F5 | **Cart lives in Zustand *and* is checkpointed to Dexie** | Zustand gives instant UI updates; the Dexie checkpoint means a browser crash mid-sale does not lose the cart. |
| F6 | **Serwist service worker** | Modern maintained successor of `next-pwa`. Precaches the app shell; API calls are **not** cached by the service worker — business data sync is explicit. |
| F7 | **big.js for money math** | Mirrors Python `Decimal` semantics (exact decimal, explicit rounding). Money travels as decimal strings (`"123.45"`) in JSON, is stored as strings in Dexie and never touches JS floats. |
| F8 | **shadcn/ui components** | Components are copied into the repo (`components/ui`) so they can be customized for touch-friendly POS use. Built on Radix (accessible) + Tailwind. |
| F9 | **Same-origin API** (`/api/v1/*`) | In dev, Next rewrites `/api` to FastAPI; in production Nginx routes it. Same origin makes the httpOnly refresh cookie first-party and removes most CORS complexity. |
| F10 | **Web Locks for the sync engine** | If the POS is open in two tabs, only one runs the sync loop (`navigator.locks`), preventing double-sends. Idempotency on the server is the safety net anyway. |

---

## 3. Backend module layout

```
backend/app/
  main.py                 app factory: middleware, routers, exception handlers
  core/                   config, database engines, redis, security primitives, logging
  shared/                 base model mixins, pagination, errors, money helpers, uuid7
  modules/
    auth/                 login, refresh rotation, PIN login, current principal
    users/                users, roles, permissions (RBAC)
    companies/            tenant root
    branches/             branches + stock locations (warehouses)
    devices/              registration, challenge-response device auth, terminals
    audit/                append-only audit log
    products/ categories/ brands/ units/ pricing/   catalog; pricing/resolver.py (pure)
    inventory/            ledger service, balances; operations.py = adjustments/counts/transfers
    review_flags/         anomalies raised instead of rejecting financial facts
    sales/ payments/ cash_management/   sales/calculation.py = the money contract
    sync/                 push.py (idempotent outbox ingest), handlers.py, pull.py (change feed)
    suppliers/ purchasing/              POs, goods receipts, moving-average cost
    customers/ returns/ promotions/     returns/service.py = voids + returns (API and sync)
    expenses/ reporting/ dashboard/     SQL aggregation, CSV exports
    catalog_io/           CSV product import (background job) / export
    realtime/             WebSocket + Redis pub/sub + device presence (optional)
    health/
  workers/                Celery app + tasks
  tests/                  (in backend/tests)
```

Each module contains only the files it needs from: `models.py`, `schemas.py`, `repository.py`,
`service.py`, `router.py`, `dependencies.py`, `exceptions.py`. Modules may import another
module's **service** or **models**, never its router.

### Shared contracts between Python and TypeScript

Two pieces of business logic run on both the server and the offline POS. Each has one reference
implementation in Python and a generated JSON file of test vectors that **both** test suites run:

| Logic | Python | Vectors | TypeScript |
|---|---|---|---|
| Sale totals, discounts, VAT, payments | `sales/calculation.py` | `shared/test-vectors/sale_calculation.json` | `lib/money/sale-calculation.ts` |
| Promotions | `promotions/evaluator.py` | `shared/test-vectors/promotions.json` | `lib/promotions/evaluate.ts` |

Regenerate vectors with `uv run python scripts/gen_sale_vectors.py` / `gen_promotion_vectors.py`
only when the algorithm intentionally changes; pytest fails if a vectors file is stale.

### Request lifecycle

```
HTTP request
  → middleware (request id, security headers, CORS)
  → router function (validates body with Pydantic)
  → Depends(): db session, current principal, require_permission(...)
  → Service method (business rules, one transaction)
      → Repository queries
      → audit.record(...)
  → Pydantic response model (serializes Decimal as string, UUID as string)
```

Domain errors are raised as subclasses of `AppError` (`NotFound`, `Conflict`,
`PermissionDenied`, `BusinessRuleViolation`) and converted to a consistent JSON error body:

```json
{ "error": { "code": "product.barcode_taken", "message": "...", "details": {...} } }
```

---

## 4. Frontend layout

```
frontend/
  app/
    (auth)/login          admin login (email + password)
    (admin)/...           admin portal pages, client components + TanStack Query
    pos/                  POS (static shell, client only)
      setup/              device initialization wizard
      login/              cashier PIN login (works offline)
  components/ui           shadcn/ui primitives
  components/shared       app-wide composites (DataTable, PageHeader, StatusBadge)
  features/<domain>/      feature components + hooks (pos, products, inventory, sync, ...)
  lib/
    api/                  typed fetch client, token refresh, error mapping
    db/                   Dexie schema + repositories (the POS "local database")
    sync/                 outbox, push/pull engine, connectivity monitor
    barcode/              scanner detection, normalization, symbology checks
    printing/             receipt rendering (58/80mm) and print transport
    money/                big.js helpers + sale calculation (shared test vectors)
    auth/                 session, offline PIN verification
  stores/                 Zustand stores (cart, terminal, ui)
  hooks/                  generic hooks
  workers/                Web Workers (catalog import)
  types/                  shared TS types (generated OpenAPI types live here)
```

---

## 5. Money, tax and rounding

The same algorithm runs in Python (server verification, reports) and TypeScript (POS).
Both are tested against `shared/test-vectors/*.json` so they cannot drift.

Per line (all amounts rounded **HALF_UP to 2 decimals** at each named step):

1. `gross = round(unit_price × quantity)`
2. `line_discount = fixed amount` or `round(gross × percent / 100)`
3. Order-level discount is allocated to lines proportionally to `gross − line_discount`,
   with the rounding remainder assigned to the largest line (so allocations sum exactly).
4. `net = gross − line_discount − allocated_order_discount`
5. Tax, per the line's tax rate:
   - prices tax-inclusive (default in PH, VAT 12%): `tax = round(net × rate / (100 + rate))`, `total = net`
   - prices tax-exclusive: `tax = round(net × rate / 100)`, `total = net + tax`
6. Sale totals are sums of line values. `change = tendered − total` (cash only).

### Senior citizen / PWD discount (RA 9994 / RA 10754)

When a senior citizen or PWD presents an ID, lines of *eligible* products
(`products.sc_pwd_eligible`, e.g. medicines) are computed differently:

1. `base = round(gross x 100 / (100 + VAT rate))` for VAT-inclusive VATable prices (else `gross`)
2. `vat_exemption = gross - base` — the sale is VAT-exempt for that line
3. `statutory_discount = round(base x 20%)`
4. `total = base - statutory_discount`, tax 0

Statutory lines take no other line discount or promotion and are excluded from the order
discount (no double discounts). The holder's name, ID number and TIN are stored on the sale,
printed on the receipt, and listed in the **senior citizen / PWD sales book** report
(`/reports/sc-pwd-book`). A statutory line on a non-eligible product is still stored (the
customer paid that) but raises a `STATUTORY_DISCOUNT_REVIEW` flag.

Not implemented: the 5% discount on basic necessities and prime commodities for senior
citizens (DTI/DA joint administrative orders) — it has its own caps and computation.

Why per line and not on the sale total? Tax rates can differ per product (VAT, VAT-exempt,
zero-rated), and per-line rounding produces receipts whose lines add up exactly.

Offline sales carry the totals the POS computed. The server **recomputes and compares**; a
mismatch is *flagged* for review, not rejected — the customer already paid that amount.

---

## 6. Where each concern lives

| Concern | Location | Doc |
|---|---|---|
| Offline behaviour | `frontend/lib/db`, `lib/sync`, service worker | [OFFLINE_ARCHITECTURE.md](OFFLINE_ARCHITECTURE.md) |
| Sync protocol | `backend/app/modules/sync`, `frontend/lib/sync` | [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md) |
| Schemas | `backend/app/modules/*/models.py`, `frontend/lib/db/schema.ts` | [DATABASE.md](DATABASE.md) |
| Inventory | `backend/app/modules/inventory` | [INVENTORY_LEDGER.md](INVENTORY_LEDGER.md) |
| Scanner | `frontend/lib/barcode` | [BARCODE_SCANNER.md](BARCODE_SCANNER.md) |
| Receipts | `frontend/lib/printing` | [RECEIPT_PRINTING.md](RECEIPT_PRINTING.md) |
| Devices | `backend/app/modules/devices`, `frontend/features/devices` | [DEVICE_MANAGEMENT.md](DEVICE_MANAGEMENT.md) |
| Auth, RBAC | `backend/app/modules/auth`, `users` | [SECURITY.md](SECURITY.md) |
| Ops | `infra/`, `docker-compose*.yml` | [DEPLOYMENT.md](DEPLOYMENT.md) |
| Tests | `backend/tests`, `frontend/**/*.test.ts`, `frontend/e2e` | [TESTING.md](TESTING.md) |

---

## 7. Future analytics / AI

Analytics code lives behind service interfaces in `modules/reporting` (and later
`modules/analytics`). Report queries return typed rows produced by PostgreSQL aggregation.
A future forecasting service can read the same ledger tables (sales, inventory movements) into
Polars/Pandas inside a Celery task, write results to its own tables (e.g.
`reorder_recommendations`), and expose them via its own router. Nothing in the transactional
path needs to change. No "AI" features are faked now.
