# Security

## 1. Principals

| Principal | How it authenticates | Used for |
|---|---|---|
| **User (admin portal)** | email + password → access token + refresh cookie | admin portal |
| **Device** | ECDSA challenge–response → device token | sync, PIN login ([DEVICE_MANAGEMENT.md](DEVICE_MANAGEMENT.md)) |
| **User on a device (POS)** | device token + username + PIN → access token bound to device | POS online calls |
| **User offline** | PIN verified locally against a synced verifier | POS offline |

## 2. Tokens

- **Access token**: JWT (HS256), **15 minutes**. Claims: `sub` (user id), `cid` (company),
  `typ` (`access` | `device`), `did` (device, when bound), `jti`, `iat`, `exp`.
  Kept **in memory only** in the browser (never in localStorage, which any XSS can read).
- **Refresh token**: 256-bit random string, **stored hashed (SHA-256)** in `refresh_tokens`,
  sent as an `httpOnly; Secure; SameSite=Strict` cookie scoped to `/api/v1/auth`.
  Lifetime 14 days (admin) / 12 hours (POS cashier sessions).
- **Rotation with reuse detection**: each refresh issues a new token in the same `family_id`
  and revokes the old one. If a revoked token is presented again, it was stolen or replayed —
  the whole family is revoked, logging out every session derived from it.
- Permissions are **not** embedded in the JWT. They are loaded per request (cached briefly),
  so removing a role takes effect within seconds, not at token expiry.

Why JWT for access tokens but opaque refresh tokens? Access tokens are verified on every
request without a DB hit. Refresh tokens are rare and must be revocable, so they live in the DB.

## 3. Passwords and PINs

- Passwords: **argon2id** (`argon2-cffi`, library defaults tuned for ~50 ms). Minimum length 10.
- Login responses do not reveal whether the email exists; timing is equalized with a dummy
  hash verification.
- PIN (4–8 digits, 6 recommended) for POS login and manager authorization:
  - `pin_hash` = argon2id — verified by the server for online PIN login.
  - `pin_offline_verifier` = PBKDF2-HMAC-SHA256(pin, per-user salt, 210 000 iterations) —
    downloaded to the branch's devices so the PIN can be verified offline with WebCrypto.

## 4. Offline authentication

Offline, the device cannot ask the server. It holds, for each staff member of the branch:
`{ user_id, username, full_name, permissions[], pin_offline_salt, pin_offline_verifier, verified_at }`.

Login offline = derive PBKDF2 from the typed PIN and compare with the verifier.

**Honest threat model:** a PIN has at most 10⁸ combinations. Anyone who extracts IndexedDB
from a stolen device can brute-force PIN verifiers offline, no matter how slow the hash is.
Therefore:
- PINs only unlock **POS actions on registered devices**. They never log in to the admin portal
  (password required), and online PIN login requires a valid device token.
- A lost device is revoked centrally, and users are prompted to change PINs.
- Local lockout: 5 failed attempts → 5-minute lock for that user on that device.
- Offline validity window (default 7 days since `verified_at`); after that, online login required.
- **The server re-validates everything on sync**: each pushed operation carries the cashier
  and (if any) authorizing manager. If that user was inactive or lacked the permission, the
  transaction is still stored (money changed hands) and a `USER_NOT_AUTHORIZED` review flag is
  raised. Offline auth is a convenience gate; server-side audit is the control.

Plain passwords are never stored anywhere. The password is never stored on the device in any
form.

## 5. RBAC

- **Permissions** are code constants (`app/modules/users/permissions.py`), grouped by domain:
  `pos.access`, `sales.void`, `sales.discount.override`, `sales.price.override`, `returns.create`,
  `cash.manage`, `products.read`, `products.write`, `inventory.adjust`, `inventory.count`,
  `inventory.transfer`, `purchasing.manage`, `customers.write`, `reports.view`,
  `reports.financial`, `users.manage`, `devices.register`, `devices.manage`, `settings.manage`,
  `audit.view`, `sync.monitor`, `expenses.manage`, …
- **Roles** are per-company data with default templates seeded on company creation:
  `OWNER` (all), `ADMIN`, `MANAGER`, `CASHIER`, `INVENTORY_CLERK`, `ACCOUNTANT`.
- **Assignments** `user_roles(user, role, branch_id)`: `branch_id = NULL` means all branches.
- **Enforcement** is server-side, in FastAPI dependencies (`require_permission(P.X)` for one
  permission, `require_any_permission(P.X, P.Y)` when several roles may read the same data):

  ```python
  @router.post("/products", dependencies=[Depends(require_permission(P.PRODUCTS_WRITE))])
  ```

  Branch-scoped operations call `principal.require(P.X, branch_id=...)` inside the service.
  The frontend hides buttons the user can't use, but that is UX, not security.

## 6. Manager authorization

Actions above a cashier's limits (void, price override, discount above limit, refund, no-sale
drawer open, cash out) show a manager PIN prompt. The POS verifies the manager's PIN locally
(works online and offline), checks the manager's permission snapshot, and records
`authorized_by_id` + reason in the transaction. An `audit_log` entry is created on sync, and the
server validates the authorizer's permission (flag if invalid).

## 7. Transport and HTTP hardening

- HTTPS only in production (Nginx terminates TLS; HSTS).
- Security headers (FastAPI middleware + Next.js config): `Strict-Transport-Security`,
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY` / CSP `frame-ancestors 'none'`, `Permissions-Policy`
  (camera allowed for self only — needed for camera scanning).
- **Content Security Policy** in Next.js: `default-src 'self'`, no third-party scripts. XSS is
  the main threat to tokens in memory and to the device key; React escapes output by default and
  `dangerouslySetInnerHTML` is banned by lint rule.
- **CORS**: same-origin deployment needs none; for development an explicit allow-list
  (`CORS_ORIGINS`). Never `*` with credentials.
- **CSRF**: the refresh cookie is `SameSite=Strict` and only accepted by the refresh/logout
  endpoints, which also require a custom header (`X-Requested-With: pos`) — a cross-site form
  cannot set custom headers.

## 8. Input validation and SQL injection

- All bodies/queries are Pydantic models with explicit constraints (lengths, ranges,
  `Decimal` with max digits, enums).
- All SQL goes through SQLAlchemy expressions or bound parameters. No string-formatted SQL.
- Sort/filter fields in list endpoints come from allow-lists, never raw column names.

## 9. Rate limiting

Redis fixed-window counters (`app/core/rate_limit.py`):
- login: 10 / minute per IP and 5 / minute per email
- PIN login: 10 / minute per device
- device challenge: 20 / minute per device
- general API: 600 requests / minute per user and per device (checked in the auth dependencies)
- sync push/pull: 120 / 240 per minute per device
Rate limiting is fail-open if Redis is down (availability of checkout-adjacent flows over
strictness), and logs a warning.

## 10. Multi-tenant isolation

Every tenant-scoped query filters by `principal.company_id`. Repositories take the company id
as a required argument, and tests assert cross-tenant access returns 404 (not 403 — don't
reveal existence).

## 11. Audit log

Append-only (`UPDATE`/`DELETE` blocked by trigger). Records who, what, when, where (device,
IP), before/after for master data changes, and every sensitive action (login, failed login,
role change, void, refund, price override, manager authorization, device registration/revocation,
cash session close, stock adjustment). Voids and returns made offline are audited when they sync,
with the device, the business time (`occurred_at`) and `"via": "sync"`.

## 12. Secrets

`.env` files are git-ignored. Production secrets (JWT secret, DB password) come from the
environment / secret store. The app refuses to start in `production` with default secrets.
