# CLAUDE.md

Offline-first POS: FastAPI backend (`backend/`), Next.js PWA (`frontend/`), design docs in `docs/`.

**Read `PROGRESS.md` first** — it holds current status, next steps, decisions and known issues.
Update it at the end of every work session.

## Commands (Windows: use `python -m uv` if `uv` is not on PATH)

```bash
cd backend
uv run python -m pytest -q                 # real PostgreSQL db `pos_test` (localhost, pos/pos)
uv run python -m ruff check . && uv run python -m ruff format --check .
uv run python -m mypy app                  # strict
uv run alembic revision --autogenerate -m "..."   # then review + add triggers (app/shared/ddl.py)
uv run alembic upgrade head

cd frontend
pnpm lint && pnpm typecheck && pnpm test && pnpm build
PW_CHANNEL=chrome pnpm test:e2e     # backend running with RATE_LIMIT_ENABLED=false
```

## Rules that must not be broken

- The POS checkout path never calls the API. Barcode → IndexedDB → cart → local sale → outbox.
- Offline-origin records use client-generated UUIDv7 as the primary key; sync endpoints are
  idempotent via PK + `sync_operations` (docs/SYNC_PROTOCOL.md).
- Money is `NUMERIC`/`Decimal` in Python, decimal strings + big.js in TS. Never floats.
- Inventory changes only via append-only `inventory_movements`; balances are a cache.
- Business logic lives in services, not routers. Services own the transaction (one commit).
- Relationships are `lazy="raise"`; load explicitly with `selectinload`. Never touch an expired
  ORM attribute in async code (capture ids before `db.expire`).
- New sync-tracked tables: add `SyncTrackedMixin` + `sync_index()` and the `sync_trigger` in the
  migration; add to `SYNC_TRACKED_TABLES` in `app/models.py`.
- Authorization is enforced server-side (`require_permission`, `principal.require`).
- Sale arithmetic and promotion evaluation exist twice (Python + TypeScript) and are pinned by
  `shared/test-vectors/*.json`. Change the Python reference, regenerate the vectors
  (`backend/scripts/gen_*_vectors.py`), then make the TS side pass — never edit vectors by hand.
- Sync handlers must never reject a financial fact for a business anomaly: store it and
  `raise_flag(...)`. REJECTED is only for invalid/foreign payloads or hard domain rules.
- Enum-typed ORM columns are VARCHAR and come back as `str`: never call `.value` on them.
- The POS (`frontend/app/pos`, `features/pos`, `lib/db`, `lib/sync`) must not call `fetch`
  in the checkout path. Dexie schema changes require a new `version()`.
- Tests: `tests/integration` runs in a rolled-back transaction; anything needing real commits
  or concurrency goes in `tests/committed` (unique company per test).
