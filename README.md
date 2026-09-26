# POS — Point of Sale, Inventory & Small Business Management

An **offline-first** POS for small businesses: FastAPI + PostgreSQL on the server, a
Next.js PWA with IndexedDB on each terminal.

> A properly initialized terminal keeps selling when the server is unreachable. When the server
> comes back, every transaction syncs **exactly once**.

| Layer | Stack |
|---|---|
| API | Python 3.13, FastAPI, Pydantic v2, SQLAlchemy 2 (async), Alembic |
| Data | PostgreSQL 17 (source of truth), Redis 7 (cache, locks, rate limits, queue) |
| Jobs | Celery + Celery beat |
| Web / POS | Next.js (App Router), React, TypeScript, Tailwind, shadcn/ui |
| Client state | TanStack Query (server state), Zustand (UI/cart), Dexie/IndexedDB (offline data) |
| Tests | pytest, Vitest + Testing Library, Playwright |

Start here: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Current status and next steps:
[PROGRESS.md](PROGRESS.md).

## What it does

- **Offline POS terminal (PWA)** — registered device with a non-extractable key, full catalog in
  IndexedDB, barcode scanning (USB/Bluetooth HID and camera) resolved locally, cart with
  discounts/promotions/price levels, hold & recall, cash / GCash / Maya / card / bank / split
  payments, 58/80 mm receipts, cash sessions with over/short, offline PIN login and manager
  approval, voids and returns, offline customers — and an outbox that syncs **exactly once**.
- **Inventory** — immutable ledger with cached balances, unit conversions, adjustments,
  barcode stock counts, transfers between locations/branches, negative-stock flags.
- **Purchasing** — suppliers, purchase orders, goods receiving, moving-average cost.
- **Management** — dashboard, 23 reports with CSV export, expenses, review flags, audit log,
  device & sync monitoring, CSV product import/export, barcode labels.
- **Administration** — multi-company, multi-branch, multi-warehouse, users with branch-scoped
  roles and permissions.

## Repository layout

```
backend/     FastAPI app (app/core, app/modules/<domain>, app/workers), Alembic, tests
frontend/    Next.js app: admin portal + offline POS PWA
docs/        architecture and design documents (the "why")
infra/       nginx config, postgres init, production env template
shared/      cross-language test vectors (money/tax math used by pytest and Vitest)
```

## Documentation

| Doc | Topic |
|---|---|
| [ARCHITECTURE](docs/ARCHITECTURE.md) | topology, key decisions, module layout, money math |
| [DATABASE](docs/DATABASE.md) | PostgreSQL schema + IndexedDB/Dexie schema |
| [OFFLINE_ARCHITECTURE](docs/OFFLINE_ARCHITECTURE.md) | what works offline and how |
| [SYNC_PROTOCOL](docs/SYNC_PROTOCOL.md) | outbox, push/pull, idempotency, cursors, conflicts |
| [INVENTORY_LEDGER](docs/INVENTORY_LEDGER.md) | immutable movements, balances, negative stock |
| [BARCODE_SCANNER](docs/BARCODE_SCANNER.md) | HID scanner detection, normalization, camera |
| [RECEIPT_PRINTING](docs/RECEIPT_PRINTING.md) | 58/80 mm, browser print, ESC/POS |
| [DEVICE_MANAGEMENT](docs/DEVICE_MANAGEMENT.md) | terminal registration, device keys, initialization |
| [FEATURES_AND_ONBOARDING](docs/FEATURES_AND_ONBOARDING.md) | optional features (switches), gating, onboarding wizard |
| [ONLINE_CATALOG](docs/ONLINE_CATALOG.md) | public browse-only store page: visibility, caching, abuse protection |
| [SECURITY](docs/SECURITY.md) | tokens, offline auth, RBAC, hardening |
| [DEPLOYMENT](docs/DEPLOYMENT.md) | production topology, backups, monitoring |
| [TESTING](docs/TESTING.md) | test strategy and critical scenarios |

## Quick start (Docker)

```bash
docker compose up --build            # postgres, redis, api, worker, beat, web
docker compose exec api python -m app.cli seed-dev
```

- Web: http://localhost:3000 · API docs: http://localhost:8000/api/v1/docs
- Demo admin login: `owner@demo.example.com` / `demo-password-123` (staff and PINs are printed by `seed-dev`)

## Running services individually (no Docker)

Prerequisites: Python 3.13, [uv](https://docs.astral.sh/uv/), Node 22+, pnpm, PostgreSQL 17,
and Redis 7 (optional in development — see below).

```bash
# Databases (once)
createuser -P pos            # password: pos
createdb -O pos pos
createdb -O pos pos_test

# Backend
cd backend
cp .env.example .env         # no Redis? set REDIS_URL=fakeredis:// and BACKGROUND_JOBS_INLINE=true
uv sync
uv run alembic upgrade head
uv run python -m app.cli seed-dev
uv run uvicorn app.main:app --reload --port 8000

# Worker (needs real Redis)
uv run celery -A app.workers.celery_app worker -l info          # add --pool=solo on Windows
uv run celery -A app.workers.celery_app beat -l info

# Frontend
cd frontend
cp .env.example .env.local
pnpm install
pnpm dev                      # http://localhost:3000, proxies /api to :8000
```

### Checks

```bash
cd backend  && uv run python -m pytest && uv run ruff check . && uv run mypy app
cd frontend && pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

### Windows notes

- If Windows **Smart App Control** blocks executables in `.venv\Scripts` (e.g. `pytest.exe`),
  run tools as modules instead: `uv run python -m pytest`, `uv run python -m uvicorn ...`.
  If it blocks mypy's compiled extension, install mypy from source:
  `set UV_NO_BINARY_PACKAGE=mypy` then `uv sync --reinstall-package mypy`.
- `REDIS_URL=fakeredis://` runs an in-process Redis substitute so the API works without Redis,
  and `BACKGROUND_JOBS_INLINE=true` runs report exports / imports in-process instead of Celery.
  Both are **development only** (the app refuses to start with them in production).
- Celery's default prefork pool is unsupported on Windows — use `--pool=solo`.
