# Device Management

A **device** is one installed POS terminal (one browser profile on one machine). Devices are
first-class records because offline transactions must be attributable to a specific,
trusted terminal.

## 1. Device identity: a key pair that never leaves the device

On registration the POS generates an **ECDSA P-256 key pair with WebCrypto, marked
non-extractable**, and stores the `CryptoKey` objects in IndexedDB. JavaScript (including
injected script) can *use* the private key while the app runs but can never read or export its
bytes. Only the public key is sent to the server.

Why not a shared secret/API key stored locally? A secret string can be copied out of
IndexedDB and replayed from anywhere. A non-extractable key can only sign on that browser
profile.

## 2. Registration flow

```
Manager logs in (online, email + password, needs `devices.register`)
  → chooses Company (implicit from user) → Branch → Terminal code & name
  → POS generates key pair, exports public key (SPKI, base64)
  → POST /api/v1/devices/register
        { branch_id, terminal_code, name, platform, app_version, public_key }
  ← device { id, status: ACTIVE, branch, terminal_code, receipt_prefix }
  → device id + keys stored in Dexie `meta`
```

`terminal_code` is unique per branch among non-revoked devices. Receipt numbers are prefixed
with `{BRANCH_CODE}-{TERMINAL_CODE}` so they are unique without coordination.

## 3. Device authentication (challenge–response)

```
POST /api/v1/devices/{id}/challenge            ← { nonce, expires_in: 60 }
   (nonce stored in Redis, single use, 60 s TTL)
sign("pos-device-auth\n{device_id}\n{nonce}") with the private key (ECDSA P-256 / SHA-256)
POST /api/v1/devices/token { device_id, nonce, signature }
                                               ← { access_token (typ=device, 60 min) }
```

The device token authorizes **sync** (push/pull) and **PIN login**. Sync therefore works even
when no cashier is logged in (e.g. transactions from yesterday's closed shift). The server
re-checks `devices.status = ACTIVE` on every device-authenticated request, so revocation takes
effect immediately.

## 4. Initialization (first download)

```
Register device
  → Download catalog      products, variants, units, categories, brands, tax rates
  → Download barcodes
  → Download prices       price levels + prices (branch overrides)
  → Download inventory    balances for the branch's locations
  → Download settings     branch, POS settings, payment methods, receipt settings
  → Download staff        offline login verifiers & permission snapshots
  → Validate              row counts == server-reported counts; spot checks (random barcodes resolve)
  → Request persistent storage
  → meta.initStatus = READY
```

The UI shows per-table progress:

```
Products        ✓ 5,284
Barcodes        ✓ 6,122
Prices          ✓
Inventory       ✓
Settings        ✓
POS READY FOR OFFLINE USE
```

The POS refuses to open the selling screen until `initStatus = READY`. A partial download is
resumable because the pull cursor is saved per batch (see [SYNC_PROTOCOL.md](SYNC_PROTOCOL.md)).

## 5. Lifecycle

| Status | Meaning |
|---|---|
| `ACTIVE` | can authenticate and sync |
| `REVOKED` | lost/stolen/replaced. Token requests fail; any pending pushes are rejected. |

Revoking a device that still has unsynced sales loses those sales from the central database,
so the admin UI shows the device's last sync time and last reported pending count, and
requires confirmation. For a planned replacement: sync the old device first, then revoke.

## 6. Monitoring

Each sync reports `pending_count`, `app_version`, `clock` and storage estimate. The server
stores `last_seen_at`, `last_sync_at` and pending count on the device row; with Redis, presence
(`device:{id}:online`, 60 s TTL) powers the live device-status view. Devices not synced for
more than a configurable threshold appear as warnings on the dashboard.

## 7. Re-initialization

"Reset terminal" (manager PIN required) refuses while the outbox contains unsynced
operations, unless forced by an owner — in which case the unsynced operations are first
exported to a JSON file for manual recovery.
