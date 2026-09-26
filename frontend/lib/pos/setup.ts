/**
 * Terminal initialization. See docs/DEVICE_MANAGEMENT.md §2 and §4.
 *
 * register → context → full paged download (resumable) → staff → validate → persist storage →
 * READY. The terminal refuses to sell until READY.
 */
import type { ApiClient } from "@/lib/api/client";
import type { DeviceClient } from "@/lib/device/device-client";
import { exportPublicKey, generateDeviceKeys } from "@/lib/device/keys";
import { getMeta, setMeta } from "@/lib/db/meta";
import type { PosDatabase } from "@/lib/db/schema";
import { SyncEngine } from "@/lib/sync/engine";
import { localCounts } from "@/lib/sync/pull-applier";
import { deviceTransport, fetchSyncContext } from "@/lib/sync/transport";
import { PULL_TABLES, type PullTableName, type SyncContext } from "@/types/sync";

export const APP_VERSION = "0.4.0";

export interface RegisterArgs {
  branchId: string;
  terminalCode: string;
  name: string;
}

interface RegisteredDevice {
  id: string;
}

/** Generate the device key pair, register it with the server and store the identity locally. */
export async function registerTerminal(db: PosDatabase, api: ApiClient, args: RegisterArgs): Promise<string> {
  const keys = await generateDeviceKeys();
  const device = await api.post<RegisteredDevice>("/devices/register", {
    branch_id: args.branchId,
    terminal_code: args.terminalCode,
    name: args.name,
    platform: typeof navigator === "undefined" ? null : navigator.userAgent.slice(0, 200),
    app_version: APP_VERSION,
    public_key: await exportPublicKey(keys),
  });
  await db.transaction("rw", db.meta, async () => {
    await setMeta(db, "deviceKeys", keys);
    await setMeta(db, "device", {
      deviceId: device.id,
      terminalCode: args.terminalCode,
      companyId: "",
      branchId: args.branchId,
      receiptPrefix: "",
      defaultStockLocationId: "",
      registeredAt: new Date().toISOString(),
    });
    await setMeta(db, "initStatus", "DOWNLOADING");
    await setMeta(db, "pullCursor", null);
    await setMeta(db, "pullMidPass", false);
  });
  return device.id;
}

/** Store what /sync/context says about this terminal. Receipt numbering never goes backwards. */
export async function applyContext(db: PosDatabase, context: SyncContext): Promise<void> {
  await db.transaction("rw", db.meta, db.settings, async () => {
    const device = await getMeta(db, "device");
    if (!device) throw new Error("Terminal is not registered");
    await setMeta(db, "device", {
      ...device,
      deviceId: context.device_id,
      terminalCode: context.terminal_code,
      companyId: context.company.id,
      branchId: context.branch.id,
      receiptPrefix: context.receipt_prefix,
      defaultStockLocationId: context.default_stock_location_id,
    });
    if (context.device_bir) {
      await setMeta(db, "deviceBir", {
        min: context.device_bir.min,
        serialNumber: context.device_bir.serial_number,
        ptuNumber: context.device_bir.ptu_number,
        ptuIssuedOn: context.device_bir.ptu_issued_on,
      });
    }
    if (context.features) await setMeta(db, "features", context.features);
    const localSeq = (await getMeta(db, "receiptSeq")) ?? 0;
    await setMeta(db, "receiptSeq", Math.max(localSeq, context.last_receipt_seq));
  });
}

export interface DownloadProgress {
  /** Expected rows per table (from the server's first page). */
  expected: Partial<Record<PullTableName, number>>;
  /** Rows received so far per table. */
  received: Partial<Record<PullTableName, number>>;
  done: boolean;
}

export class ValidationFailedError extends Error {
  constructor(readonly mismatches: { table: string; expected: number; local: number }[]) {
    super(`Local database does not match the server: ${mismatches.map((m) => m.table).join(", ")}`);
    this.name = "ValidationFailedError";
  }
}

/** Full download (resumable: the pull cursor is saved after every page) and validation. */
export async function downloadAndValidate(
  db: PosDatabase,
  client: DeviceClient,
  onProgress: (progress: DownloadProgress) => void,
): Promise<void> {
  await applyContext(db, await fetchSyncContext(client));
  const expected: Partial<Record<PullTableName, number>> = (await getMeta(db, "initCounts")) ?? {};
  const received: Partial<Record<PullTableName, number>> = {};
  const engine = new SyncEngine({
    db,
    transport: deviceTransport(client),
    appVersion: APP_VERSION,
    onPullPage: (page) => {
      if (page.counts) Object.assign(expected, page.counts);
      for (const table of PULL_TABLES) {
        const rows = page.changes[table]?.length ?? 0;
        if (rows) received[table] = (received[table] ?? 0) + rows;
      }
      onProgress({ expected: { ...expected }, received: { ...received }, done: !page.has_more });
    },
  });
  await engine.pullAll();
  await setMeta(db, "initCounts", expected as Record<string, number>);

  const local = await localCounts(db);
  const mismatches = PULL_TABLES.flatMap((table) => {
    const want = expected[table];
    const have = local[table] ?? 0;
    return want !== undefined && have < want ? [{ table, expected: want, local: have }] : [];
  });
  if (mismatches.length > 0) throw new ValidationFailedError(mismatches);
  if (!(await db.staff.count())) throw new ValidationFailedError([{ table: "staff", expected: 1, local: 0 }]);

  let persisted = false;
  try {
    persisted = (await navigator.storage?.persist?.()) ?? false;
  } catch {
    persisted = false;
  }
  await setMeta(db, "persistentStorage", persisted);
  await setMeta(db, "lastSyncAt", new Date().toISOString());
  await setMeta(db, "initStatus", "READY");
}

export async function isTerminalReady(db: PosDatabase): Promise<boolean> {
  return (await getMeta(db, "initStatus")) === "READY";
}
