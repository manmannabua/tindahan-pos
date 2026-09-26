# Optional features and onboarding

Not every store uses everything. A sari-sari store may want just selling and a cash drawer; a
pharmacy needs Senior citizen / PWD discounts and BIR readings; a mini-mart buys from suppliers.
The owner switches optional features on or off, and switched-off features disappear.

## 1. What is optional

Always on (the core): products & catalog, the POS checkout (offline), sales history & voids,
reports on sales, staff & roles, branches, terminals, sync and review flags.

| Key | Feature | Covers | Needs |
|---|---|---|---|
| `inventory` | Stock tracking | stock pages, counts, transfers, low-stock card/reports, POS stock warning, opening stock on import, stock in the online catalog | |
| `purchasing` | Purchasing & suppliers | suppliers, purchase orders, receiving | `inventory` |
| `customers` | Customers | customer list, customer on POS sales | |
| `promotions` | Promotions | promotion setup; the POS applies promos only while on | |
| `discounts` | Manual discounts | POS line / whole-sale discount buttons | |
| `returns` | Returns & refunds | POS and back-office returns, returns report | |
| `cash_management` | Cash drawer sessions | POS Cash tab, opening float / close count (sessions are not required while off), cash-drawer report | |
| `expenses` | Expenses | expenses pages and report | |
| `sc_pwd` | Senior citizen / PWD | POS Senior/PWD button, product eligibility switch, SC/PWD sales book | |
| `bir` | BIR compliance | accreditation / MIN / PTU fields, X/Z readings (POS), terminal-reading report | |
| `online_catalog` | Online catalog | public store page (404 while off), show-online switches and bulk actions | |
| `receipt_journal` | Receipt journal screens | POS and admin Receipts pages, "View receipt" (receipts are **always** recorded) | |

The catalogue lives in `backend/app/modules/companies/features.py` (labels, descriptions,
dependencies, presets); the frontend keys are in `frontend/lib/features.ts`.

## 2. How switching works

- **Storage:** `companies.features` holds explicit choices only; a missing key means **on**. So
  existing businesses keep everything, and a feature added in a later release is on until the
  owner decides otherwise (on both server and client).
- **Dependencies:** a feature whose requirement is off is off. `PUT /companies/current/features`
  rejects inconsistent combinations (`feature.requires`); the settings UI keeps them consistent
  while you click (off → dependents off, on → requirements on).
- **Server:** `require_feature(Feature.X)` guards whole routers (purchasing, suppliers,
  inventory, customers, promotions, expenses, storefront, receipts) or single routes (returns,
  per-report via `ReportDef.feature`) and answers `403 feature.disabled`. The report list only
  shows available reports.
- **Sync is never gated.** A terminal that sold offline with a promotion, a customer or a return
  before the owner switched it off still uploads it; facts are never lost because of a setting.
- **Admin portal:** the session carries `company.features`; the sidebar hides items, a route
  guard in `AdminShell` shows "X is turned off" for direct links, and components hide
  feature-specific buttons and fields (`useFeature`).
- **Terminals:** `/sync/context` carries the features; they are stored in IndexedDB
  (`meta.features`) on every sync and read live (`usePosFeature`), so a change reaches a terminal
  on its next sync and works offline with the last known state.
- Turning a feature off never deletes data; switching it back on shows everything again.
- Changes are audited (`company.features_changed`); only `company.manage` (owners) may switch.

## 3. Onboarding

A new business (`onboarding_completed_at` null) is sent to `/onboarding` after sign-up; the
owner is redirected there until done. Staff can use the portal meanwhile. Steps:

1. **Business** — name, legal name, TIN, VAT-registered, prices include VAT.
2. **Store** — branch name, address, phone, receipt footer.
3. **Features** — presets *Basic* / *Standard* (recommended, pre-selected) / *Everything*, then
   individual switches.
4. **Next steps** — links: add or import products, add staff, set up a terminal, and (when on)
   online catalog and BIR details.

"Skip for now" finishes onboarding with everything on. Businesses that existed before this
release were marked as onboarded by the migration.
