# POS frontend (Next.js)

Admin portal + offline-first POS terminal in one Next.js 16 app (App Router, React 19,
TypeScript strict, Tailwind v4, shadcn/ui on Base UI). Architecture and the reasons behind it:
[../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) §2.2 and §4.

## Run

```bash
pnpm install
cp .env.example .env.local        # API_ORIGIN=http://localhost:8000
pnpm dev                          # http://localhost:3000 (backend must be running)
```

The browser only ever calls same-origin `/api/*`; `next.config.ts` rewrites it to `API_ORIGIN`
(Nginx does the same in production). That keeps the httpOnly refresh cookie first-party.

| Script | What |
|---|---|
| `pnpm dev` / `build` / `start` | Next.js (Turbopack) |
| `pnpm lint` · `pnpm typecheck` | ESLint · route typegen + `tsc --noEmit` (includes the API contract check) |
| `pnpm test` | Vitest unit/component tests (jsdom + fake-indexeddb) |
| `pnpm test:e2e` | Playwright. Backend must be running. `E2E_BASE_URL` targets an already-running app, `E2E_API_URL` the backend for seeding/verification (default `http://localhost:8000/api/v1`); `PW_CHANNEL=chrome` uses installed Chrome (needed where Playwright's browser download is blocked). Each run signs up new companies: start the e2e backend with `RATE_LIMIT_ENABLED=false` (signup is limited to 5/hour per IP) |
| `pnpm gen:api` | Regenerate `types/openapi.d.ts` from the running backend |
| `pnpm gen:icons` | Regenerate placeholder PWA icons |

## Folder map

```
app/
  (auth)/login, signup         admin sign-in / business sign-up
  (admin)/…                    admin portal (client components + TanStack Query)
  pos/                         the whole terminal (PIN login, sell, cash, sales, sync views — no navigation)
  pos/setup                    terminal registration + first download (online)
  pos/login                    pointer to /pos (the PIN session is memory-only)
  serwist/[path]/route.ts      builds + serves the service worker (/serwist/sw.js)
  sw.ts                        service worker source
  manifest.ts                  PWA manifest
components/ui                  shadcn/ui primitives (Base UI)
components/shared              app-wide composites (PageHeader, form fields, dialogs)
features/<domain>/             api.ts (query keys + hooks) and components per domain
lib/api                        fetch client: in-memory token, single-flight refresh, ApiError
lib/auth                       session restore/refresh, permission checks (mirror backend Principal)
lib/money                      big.js decimal helpers — never JS floats for money
lib/barcode                    normalization, symbology, scanner keystroke detector
lib/db                         Dexie schema v1 (terminal DB), meta/settings, catalog lookup/search, POS context
lib/device                     WebCrypto device key pair (non-extractable), device-token client
lib/money                      big.js helpers + sale-calculation.ts (contract with the backend, shared vectors)
lib/pricing                    price resolver (mirror of backend resolver.py)
lib/pos                        cart model, completeSale (one Dexie transaction), cash sessions, setup, receipts
lib/printing                   receipt model + 58/80 mm layout, hidden-iframe printing, Z-read
lib/sync                       outbox, sync engine (push/pull/reconcile), runner (Web Locks), service, connectivity
lib/auth                       session refresh, permission checks, offline PIN verification + lockout
stores/                        Zustand: auth session, terminal status, cart, POS session (cashier, cash session)
features/pos                   terminal UI: setup wizard, PIN login, sell screen, payment, cash, history, sync monitor
test-utils/                    terminal DB fixture seeded through the real pull applier
hooks/                         use-barcode-scanner, use-debounced-value
types/                         api.ts (hand-written), openapi.d.ts (generated), api-contract.ts (drift check)
```

## Where state lives

| State | Tool | Notes |
|---|---|---|
| Server data for the admin portal | TanStack Query | query keys in `features/*/api.ts` |
| Access token + current user | Zustand `auth-store` | memory only — never localStorage |
| Refresh token | httpOnly cookie | `rt_admin` / `rt_pos`, path `/api/v1/auth` |
| Terminal status (online/offline/sync) | Zustand `terminal-store` | |
| Offline business data (catalog, sales, outbox) | Dexie / IndexedDB | `lib/db/schema.ts` |
| Cart being built | Zustand `cart-store` | checkpointed to IndexedDB (`activeCart`), restored after a crash |
| Logged-in cashier | Zustand `pos-session-store` | memory only: a reload returns to the PIN screen |
| Device token | `DeviceClient` (memory) | re-obtained by signing a server challenge with the device key |

## PWA

Service worker via **@serwist/turbopack** (Next 16 builds with Turbopack; the webpack plugin
`@serwist/next` doesn't apply). It precaches the app shell (`/_next/static`, icons, `/pos*`
pages) and never caches `/api/*` — business data is synced explicitly into IndexedDB. The SW is
registered only in production builds, doesn't reload on reconnect and doesn't `skipWaiting`
automatically (no code swaps mid-sale). It's bundled with `esbuild-wasm` to avoid native
binaries.

## Offline POS in one paragraph

`/pos/setup` registers the device (key pair generated here, public key sent), then downloads the
catalog, prices, inventory, settings and staff PIN verifiers into IndexedDB with per-table
progress and validation. From then on `/pos` never needs the network: scans are looked up in
IndexedDB, a sale is ONE Dexie transaction (sale, items, payments, provisional stock movements,
outbox entry, receipt number), and the sync engine (`lib/sync`) pushes the outbox and pulls
changes in the background, exactly once thanks to the server's idempotency. The critical
Playwright test (`e2e/offline-sales.spec.ts`) proves it: 20 sales with the API down, a restart,
reconnect → exactly 20 sales in PostgreSQL.
