/**
 * Offline PIN verification. See docs/SECURITY.md §4.
 *
 * The server sends, for staff who may use this terminal, a PBKDF2-HMAC-SHA256 verifier of their
 * PIN (backend app/core/security.py `make_offline_pin_verifier`). We derive the same value from the
 * typed PIN with WebCrypto and compare in constant time. Plain PINs are never stored.
 */
import { fromBase64 } from "@/lib/device/keys";
import { getMeta, setMeta } from "@/lib/db/meta";
import type { LocalStaff, PosDatabase } from "@/lib/db/schema";

export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 5 * 60_000;
/** Offline login stops working this long after the last staff snapshot from the server. */
export const OFFLINE_VALIDITY_MS = 7 * 24 * 3600_000;

export async function derivePinVerifier(pin: string, saltB64: string, iterations: number): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64(saltB64), iterations },
    material,
    256,
  );
  return new Uint8Array(bits);
}

export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function pinMatches(staff: LocalStaff, pin: string): Promise<boolean> {
  if (!staff.pinSalt || !staff.pinVerifier || !staff.pinIterations) return false;
  const derived = await derivePinVerifier(pin, staff.pinSalt, staff.pinIterations);
  return constantTimeEqual(derived, fromBase64(staff.pinVerifier));
}

export type PinCheck =
  | { ok: true; staff: LocalStaff }
  | { ok: false; reason: "unknown" | "no_pin" | "not_allowed" | "locked" | "wrong_pin" | "expired"; lockedUntil?: string; attemptsLeft?: number };

/**
 * Verify a PIN locally with lockout (5 failures → 5 minutes, per user, per terminal).
 * `requiredPermission` (e.g. `sales.void` for manager authorization) is checked against the
 * permission snapshot; the server re-validates every synced operation anyway.
 */
export async function checkPin(
  db: PosDatabase,
  staffId: string,
  pin: string,
  options: { requiredPermission?: string; now?: Date } = {},
): Promise<PinCheck> {
  const now = options.now ?? new Date();
  const staff = await db.staff.get(staffId);
  if (!staff) return { ok: false, reason: "unknown" };
  if (!staff.isActive || !staff.canUsePos) return { ok: false, reason: "not_allowed" };
  if (!staff.pinVerifier) return { ok: false, reason: "no_pin" };

  const syncedAt = await getMeta(db, "staffSyncedAt");
  if (!syncedAt || now.getTime() - new Date(syncedAt).getTime() > OFFLINE_VALIDITY_MS) {
    return { ok: false, reason: "expired" };
  }

  const key = `pinLockout:${staffId}` as const;
  const lockout = (await getMeta(db, key)) ?? { failures: 0, lockedUntil: null };
  if (lockout.lockedUntil && new Date(lockout.lockedUntil) > now) {
    return { ok: false, reason: "locked", lockedUntil: lockout.lockedUntil };
  }

  if (!(await pinMatches(staff, pin))) {
    const failures = (lockout.lockedUntil ? 0 : lockout.failures) + 1;
    const lockedUntil = failures >= MAX_FAILURES ? new Date(now.getTime() + LOCKOUT_MS).toISOString() : null;
    await setMeta(db, key, { failures: lockedUntil ? 0 : failures, lockedUntil });
    return lockedUntil
      ? { ok: false, reason: "locked", lockedUntil }
      : { ok: false, reason: "wrong_pin", attemptsLeft: MAX_FAILURES - failures };
  }
  await setMeta(db, key, { failures: 0, lockedUntil: null });
  if (options.requiredPermission && !staff.permissions.includes(options.requiredPermission)) {
    return { ok: false, reason: "not_allowed" };
  }
  return { ok: true, staff };
}

export function pinCheckMessage(check: Exclude<PinCheck, { ok: true }>): string {
  switch (check.reason) {
    case "wrong_pin":
      return `Wrong PIN. ${check.attemptsLeft} attempt${check.attemptsLeft === 1 ? "" : "s"} left.`;
    case "locked":
      return `Too many attempts. Try again after ${new Date(check.lockedUntil ?? "").toLocaleTimeString()}.`;
    case "expired":
      return "Offline login has expired for this terminal. Connect to the server to refresh staff data.";
    case "no_pin":
      return "No PIN is set for this user. Ask a manager to set one in the admin portal.";
    case "not_allowed":
      return "This user is not allowed to do this.";
    default:
      return "Unknown user.";
  }
}
