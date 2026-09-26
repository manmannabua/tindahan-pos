/**
 * The terminal's background sync (browser singleton). Wires the engine to IndexedDB, the device
 * client and the terminal status store. Nothing here blocks the checkout path.
 */
import { getDeviceClient } from "@/lib/device";
import { getMeta } from "@/lib/db/meta";
import { getDb } from "@/lib/db/schema";
import { APP_VERSION, applyContext } from "@/lib/pos/setup";
import { useTerminalStore } from "@/stores/terminal-store";

import { SyncEngine } from "./engine";
import { SyncRunner } from "./runner";
import { deviceTransport, fetchSyncContext } from "./transport";

let runner: SyncRunner | null = null;
let unsubscribe: (() => void) | null = null;

export async function startSync(): Promise<void> {
  if (runner) return;
  const db = getDb();
  const lastSyncAt = await getMeta(db, "lastSyncAt");
  if (lastSyncAt) useTerminalStore.getState().setSyncState({ lastSyncAt });

  const client = getDeviceClient();
  const engine = new SyncEngine({
    db,
    transport: deviceTransport(client),
    appVersion: APP_VERSION,
    afterPull: async () => applyContext(db, await fetchSyncContext(client)),
  });
  runner = new SyncRunner({
    db,
    engine,
    // Unknown = still probing: try anyway, the engine handles an unreachable server.
    isOnline: () => useTerminalStore.getState().connectivity !== "offline",
    onRunStart: () => useTerminalStore.getState().setSyncState({ syncActivity: "syncing" }),
    onRunEnd: (result, error) => {
      const state = useTerminalStore.getState();
      if (error || !result) {
        state.setSyncState({ syncActivity: "error", syncError: error ?? "Sync failed" });
        return;
      }
      state.setSyncState({
        syncActivity: result.failed > 0 ? "error" : "idle",
        syncError: result.failed > 0 ? `${result.failed} operation(s) need attention` : null,
        lastSyncAt: new Date().toISOString(),
      });
    },
  });

  // Reconnect → sync right away.
  let previous = useTerminalStore.getState().connectivity;
  unsubscribe = useTerminalStore.subscribe((state) => {
    if (state.connectivity === "online" && previous !== "online") {
      void engine.resetBackoff().then(() => runner?.trigger());
    }
    if (state.connectivity === "offline" && state.syncActivity !== "idle") {
      useTerminalStore.getState().setSyncState({ syncActivity: "idle" });
    }
    previous = state.connectivity;
  });
  await runner.start();
}

export function triggerSync(): void {
  runner?.trigger();
}

export function stopSync(): void {
  runner?.stop();
  unsubscribe?.();
  runner = null;
  unsubscribe = null;
}

/** Tests / debugging: wait for the running cycle. */
export async function syncIdle(): Promise<void> {
  await runner?.idle();
}
