import { pbkdf2Sync, randomBytes } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setMeta } from "@/lib/db/meta";
import type { PosDatabase } from "@/lib/db/schema";
import { applyPullPage } from "@/lib/sync/pull-applier";
import { catalogPage, createTerminalDb, destroyDb, IDS, staffRow } from "@/test-utils/terminal-fixture";

import { checkPin, constantTimeEqual, MAX_FAILURES } from "./pin";

/** Exactly what the backend does: make_offline_pin_verifier (app/core/security.py). */
function backendVerifier(pin: string, iterations = 1000) {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(pin, salt, iterations, 32, "sha256");
  return { pin_offline_salt: salt.toString("base64"), pin_offline_verifier: derived.toString("base64"), pin_offline_iterations: iterations };
}

let db: PosDatabase;
const now = new Date("2026-09-26T08:00:00Z");

beforeEach(async () => {
  db = await createTerminalDb();
  await applyPullPage(db, {
    ...catalogPage(),
    changes: {},
    staff: [
      staffRow({ id: IDS.cashier, username: "cathy", ...backendVerifier("482915") }),
      staffRow({ id: IDS.manager, username: "mara", permissions: ["pos.access", "sales.void"], ...backendVerifier("246810") }),
      staffRow({ id: "acct", username: "acct", can_use_pos: false }),
    ],
  }, now);
});
afterEach(async () => {
  await destroyDb(db);
});

describe("checkPin (offline)", () => {
  it("accepts the right PIN against a backend-generated verifier", async () => {
    const result = await checkPin(db, IDS.cashier, "482915", { now });
    expect(result.ok).toBe(true);
  });

  it("rejects wrong PINs and locks out after five failures", async () => {
    for (let i = 1; i < MAX_FAILURES; i++) {
      expect(await checkPin(db, IDS.cashier, "000000", { now })).toMatchObject({ ok: false, reason: "wrong_pin", attemptsLeft: MAX_FAILURES - i });
    }
    expect(await checkPin(db, IDS.cashier, "000000", { now })).toMatchObject({ ok: false, reason: "locked" });
    // Even the right PIN is refused while locked…
    expect(await checkPin(db, IDS.cashier, "482915", { now })).toMatchObject({ reason: "locked" });
    // …and accepted after the lockout.
    expect((await checkPin(db, IDS.cashier, "482915", { now: new Date(now.getTime() + 6 * 60_000) })).ok).toBe(true);
  });

  it("checks the permission snapshot for manager approvals", async () => {
    expect((await checkPin(db, IDS.manager, "246810", { now, requiredPermission: "sales.void" })).ok).toBe(true);
    expect(await checkPin(db, IDS.cashier, "482915", { now, requiredPermission: "sales.void" })).toMatchObject({ reason: "not_allowed" });
  });

  it("refuses users who cannot use the POS and stale staff data", async () => {
    expect(await checkPin(db, "acct", "1234", { now })).toMatchObject({ reason: "not_allowed" });
    await setMeta(db, "staffSyncedAt", new Date(now.getTime() - 8 * 24 * 3600_000).toISOString());
    expect(await checkPin(db, IDS.cashier, "482915", { now })).toMatchObject({ reason: "expired" });
  });

  it("compares in constant time", () => {
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});
