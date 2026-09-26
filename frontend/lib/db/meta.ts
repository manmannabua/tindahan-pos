/**
 * Typed access to the terminal's `meta` table (device identity, init status, sync cursors…).
 */
import { DEFAULT_SCANNER_OPTIONS } from "@/lib/barcode/scanner-detector";

import type { PosDatabase } from "./schema";

export type InitStatus = "NONE" | "DOWNLOADING" | "READY";

export interface DeviceIdentity {
  deviceId: string;
  terminalCode: string;
  companyId: string;
  branchId: string;
  receiptPrefix: string;
  defaultStockLocationId: string;
  registeredAt: string;
}

export interface PinLockout {
  failures: number;
  lockedUntil: string | null;
}

export interface MetaValues {
  device: DeviceIdentity;
  deviceKeys: CryptoKeyPair;
  initStatus: InitStatus;
  /** Opaque pull cursor from the server (null = start a full download). */
  pullCursor: string | null;
  /** Row counts of the initial download (validation). */
  initCounts: Record<string, number>;
  /** Highest receipt sequence used on this terminal. */
  receiptSeq: number;
  /** Highest return-slip sequence used on this terminal. */
  returnSeq: number;
  lastSyncAt: string;
  /** When the staff snapshot (offline PIN verifiers) was last received from the server. */
  staffSyncedAt: string;
  lastPullCompletedAt: string;
  /** True while a pull pass is incomplete (resume with `pullCursor`). */
  pullMidPass: boolean;
  /** When the current/last pull pass started (reconciliation boundary). */
  pullPassStartedAt: string;
  persistentStorage: boolean;
  [key: `pinLockout:${string}`]: PinLockout;
}

export type MetaKey = keyof MetaValues & string;

export async function getMeta<K extends MetaKey>(db: PosDatabase, key: K): Promise<MetaValues[K] | undefined> {
  const row = await db.meta.get(key);
  return row?.value as MetaValues[K] | undefined;
}

export async function setMeta<K extends MetaKey>(db: PosDatabase, key: K, value: MetaValues[K]): Promise<void> {
  await db.meta.put({ key, value });
}

export async function deleteMeta(db: PosDatabase, key: MetaKey): Promise<void> {
  await db.meta.delete(key);
}

// --- Settings --------------------------------------------------------------------------------

export type ReceiptWidth = 58 | 80;

export interface TerminalSettings {
  receiptWidth: ReceiptWidth;
  requireCashSession: boolean;
  printReceiptAutomatically: boolean;
  scannerSound: boolean;
  /** Warn when selling more than local stock (never blocks). */
  warnOnNegativeStock: boolean;
  /** Keyboard-wedge scanner detection (see lib/barcode/scanner-detector). Slow Bluetooth
   * scanners may need larger gaps. */
  scannerMinLength: number;
  scannerMaxInterKeyMs: number;
  scannerMaxAvgInterKeyMs: number;
}

export const DEFAULT_SETTINGS: TerminalSettings = {
  receiptWidth: 80,
  requireCashSession: true,
  printReceiptAutomatically: true,
  scannerSound: true,
  warnOnNegativeStock: true,
  scannerMinLength: DEFAULT_SCANNER_OPTIONS.minLength,
  scannerMaxInterKeyMs: DEFAULT_SCANNER_OPTIONS.maxInterKeyMs,
  scannerMaxAvgInterKeyMs: DEFAULT_SCANNER_OPTIONS.maxAvgInterKeyMs,
};

export async function getTerminalSettings(db: PosDatabase): Promise<TerminalSettings> {
  const row = await db.settings.get("terminal");
  return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<TerminalSettings> | undefined) ?? {}) };
}

export async function saveTerminalSettings(db: PosDatabase, patch: Partial<TerminalSettings>): Promise<void> {
  const current = await getTerminalSettings(db);
  await db.settings.put({ key: "terminal", value: { ...current, ...patch } });
}
