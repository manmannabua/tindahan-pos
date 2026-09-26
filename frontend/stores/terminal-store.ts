import { create } from "zustand";

import type { Connectivity } from "@/lib/sync/connectivity";

export type SyncActivity = "idle" | "syncing" | "error";

interface TerminalState {
  connectivity: Connectivity;
  syncActivity: SyncActivity;
  /** Outbox operations not yet acknowledged by the server. */
  pendingCount: number;
  lastSyncAt: string | null;
  syncError: string | null;
  setConnectivity: (connectivity: Connectivity) => void;
  setSyncState: (state: Partial<Pick<TerminalState, "syncActivity" | "pendingCount" | "lastSyncAt" | "syncError">>) => void;
}

/** POS terminal runtime state (UI only; durable data lives in IndexedDB). */
export const useTerminalStore = create<TerminalState>()((set) => ({
  connectivity: "unknown",
  syncActivity: "idle",
  pendingCount: 0,
  lastSyncAt: null,
  syncError: null,
  setConnectivity: (connectivity) => set({ connectivity }),
  setSyncState: (state) => set(state),
}));

export type TerminalStatusKind = "ONLINE" | "OFFLINE" | "SYNCING" | "SYNC_ERROR" | "CHECKING";

export interface TerminalStatus {
  kind: TerminalStatusKind;
  label: string;
}

/** The cashier-facing status (docs/SYNC_PROTOCOL.md §7). Offline wins: it matters most. */
export function deriveTerminalStatus(
  state: Pick<TerminalState, "connectivity" | "syncActivity" | "pendingCount">,
): TerminalStatus {
  if (state.connectivity === "offline") {
    return {
      kind: "OFFLINE",
      label: state.pendingCount > 0 ? `OFFLINE — ${state.pendingCount} pending` : "OFFLINE",
    };
  }
  if (state.syncActivity === "error") return { kind: "SYNC_ERROR", label: "SYNC ERROR" };
  if (state.syncActivity === "syncing") {
    return { kind: "SYNCING", label: `SYNCING — ${state.pendingCount} pending` };
  }
  if (state.connectivity === "unknown") return { kind: "CHECKING", label: "CHECKING…" };
  return { kind: "ONLINE", label: "ONLINE" };
}

/** "Last synced: 2 minutes ago" */
export function formatLastSynced(lastSyncAt: string | null, now: Date = new Date()): string {
  if (!lastSyncAt) return "Never synced";
  const seconds = Math.max(0, Math.round((now.getTime() - new Date(lastSyncAt).getTime()) / 1000));
  if (seconds < 45) return "Last synced: just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Last synced: ${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last synced: ${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `Last synced: ${days} day${days === 1 ? "" : "s"} ago`;
}
