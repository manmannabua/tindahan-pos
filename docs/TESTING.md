# Testing Strategy

## 1. Pyramid

| Level | Tool | What | Where |
|---|---|---|---|
| Unit (backend) | pytest | pure logic: money/tax math, promotions, barcodes, price resolution, permissions, tokens | `backend/tests/unit` |
| Integration (backend) | pytest + httpx `AsyncClient` + real PostgreSQL, rolled back per test | API → service → DB, constraints, idempotency, RBAC, tenant isolation, inventory, sync push, reports | `backend/tests/integration` |
| Committed (backend) | pytest, real commits | behaviour that needs committed data or separate connections: pull cursors, **concurrent pushes**, background jobs (exports, imports) | `backend/tests/committed` |
| Unit / component (frontend) | Vitest + Testing Library + fake-indexeddb | calculation vectors, promotions, scanner detector, cart, `completeSale` atomicity, sync engine, pull applier, PIN verification, device signatures | `frontend/**/*.test.ts(x)` |
| End-to-end | Playwright (installed Chrome) | real browser + real API: offline selling, restart, sync, multi-terminal oversell, admin flows | `frontend/e2e` |

## 2. Principles

- **Real PostgreSQL.** Idempotency, unique constraints, `ON CONFLICT`, triggers, `NUMERIC` and
  transaction-id cursors are what matter most; SQLite would lie about all of them. The test
  database `pos_test` is dropped and migrated (`alembic upgrade head`) at the start of every run,
  so migrations are tested on every run too.
- **Isolation.** Integration tests run inside an outer transaction that is rolled back; service
  code still calls `commit()` (it only releases a savepoint). Tests that must see truly
  committed data live in `tests/committed/` and use a unique company per test; tests in
  `integration/` therefore scope any global counts by company.
- **Redis** is `fakeredis` in tests; background jobs run in-process (`BACKGROUND_JOBS_INLINE`).
- **Shared test vectors** (`shared/test-vectors/*.json`) are executed by pytest *and* Vitest so
  the POS and the server cannot compute different totals or promotions. pytest fails if a
  vectors file no longer matches the Python implementation.
- Tests assert business outcomes (sale counts, ledger sums, refunds), not implementation details.

## 3. The critical scenario (Playwright, `frontend/e2e`)

```
1. Initialize the terminal online through the UI (register device, full download)
2. PIN login, open cash session
3. Block **/api/** → status shows OFFLINE
4. Complete 20 sales by scanning barcodes (cash, GCash with reference, one split payment)
5. Reload the page
6. Assert 20 sales + outbox rows are still in IndexedDB
7. Unblock → wait for "Last synced" and 0 pending
8. Via the admin API: exactly 20 sales for the device, receipt numbers 000001–000020 without
   duplicates, payments equal totals, stock decreased exactly, a forced second sync adds nothing
```

The backend has the same guarantee at the protocol level (`tests/integration/test_sync_push.py`:
20-sale day pushed twice → 20 sales; `tests/committed/test_sync_concurrency.py`: the same batch
pushed by 4 concurrent requests → each sale applied exactly once).

## 4. Scenario coverage

| Scenario | Where |
|---|---|
| Push same batch twice / concurrently → one sale each | `integration/test_sync_push.py`, `committed/test_sync_concurrency.py` |
| Rebuilt outbox (same sale, new op id) → DUPLICATE; changed payload → CONFLICT | `integration/test_sync_push.py` |
| Sale before its cash session / customer → DEFERRED, then applied | `test_sync_push.py`, `test_returns_voids.py` |
| Two offline terminals oversell → both kept, balance −2, one NEGATIVE_INVENTORY flag | backend `test_inventory.py`, `test_sync_push.py`; Playwright two-terminal spec |
| Split payments, change, cash expected at close | `test_sync_push.py`, shared vectors |
| Returns (partial, pro-rata, exact remainder, over-return refused), voids (session rule) | `test_returns_voids.py` |
| Stock transfers (in transit, shortage flag, cancel returns goods) | `test_inventory_operations.py` |
| Unit conversion (sell/adjust/receive in BOX, ledger in PC) | `test_inventory_operations.py`, `test_purchasing.py` |
| Tax inclusive/exclusive, exempt, zero-rated; discount allocation remainders | shared vectors + `unit/test_sale_calculation.py` |
| Promotions (kinds, priority, windows, branches) | shared vectors + `unit/test_promotion_evaluator.py`; Vitest |
| Manager authorization offline (PIN verifier), permission re-validation on sync | Vitest; `test_sync_push.py` (USER_NOT_AUTHORIZED) |
| Sync retry after 500 / timeout, backoff, SYNCING reset, 401 re-auth | Vitest sync engine tests |
| Pull cursor never skips a committed transaction; branch scoping; staff verifiers | `committed/test_sync_pull.py` |
| Tenant isolation, refresh-token reuse, privilege escalation | `test_rbac.py`, `test_auth.py` |
| Reports match hand-computed figures | `test_reports.py` |
| CSV import/export | `committed/test_catalog_io.py` |

## 5. Commands

```bash
# backend (PostgreSQL running; test DB pos_test owned by role pos)
cd backend
uv run python -m pytest                 # everything (~30 s)
uv run python -m pytest tests/unit -q   # fast, no database
uv run python -m ruff check . && uv run python -m ruff format --check . && uv run python -m mypy app

# frontend
cd frontend
pnpm test                               # Vitest
pnpm lint && pnpm typecheck && pnpm build
PW_CHANNEL=chrome pnpm test:e2e         # needs the backend running (see frontend/README.md);
                                        # start it with RATE_LIMIT_ENABLED=false: each run signs up companies

# performance (development database only)
cd backend && uv run python scripts/benchmark_sync.py --products 1000 --sales 500
```

Reference numbers on a developer laptop (PostgreSQL 17, single uvicorn process): full download
of 1,000 products (~6,000 rows) in ~0.4 s; push ~50 sales/s (3 lines each, one transaction per
sale); re-push of 500 already-synced sales ~0.25 s; sales summary over 500 sales ~60 ms.
