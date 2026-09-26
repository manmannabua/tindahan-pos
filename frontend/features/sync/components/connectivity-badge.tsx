"use client";

import { CloudOffIcon, CloudIcon, LoaderIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";

import { cn } from "@/lib/utils";
import {
  deriveTerminalStatus,
  formatLastSynced,
  type TerminalStatusKind,
  useTerminalStore,
} from "@/stores/terminal-store";

const STYLES: Record<TerminalStatusKind, { className: string; icon: typeof CloudIcon }> = {
  ONLINE: { className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200", icon: CloudIcon },
  OFFLINE: { className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200", icon: CloudOffIcon },
  SYNCING: { className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200", icon: RefreshCwIcon },
  SYNC_ERROR: { className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200", icon: TriangleAlertIcon },
  CHECKING: { className: "bg-muted text-muted-foreground", icon: LoaderIcon },
};

/** Re-render periodically so "2 minutes ago" stays current. */
function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** ONLINE · OFFLINE · SYNCING — n pending · SYNC ERROR, plus "Last synced" (SYNC_PROTOCOL.md §7). */
export function ConnectivityBadge({ className }: { className?: string }) {
  const state = useTerminalStore(
    useShallow((s) => ({
      connectivity: s.connectivity,
      syncActivity: s.syncActivity,
      pendingCount: s.pendingCount,
      lastSyncAt: s.lastSyncAt,
    })),
  );
  const now = useNow(30_000);
  const status = deriveTerminalStatus(state);
  const { className: tone, icon: Icon } = STYLES[status.kind];

  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span
        role="status"
        aria-live="polite"
        className={cn("inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-semibold tracking-wide", tone)}
      >
        <Icon className={cn("size-4", (status.kind === "SYNCING" || status.kind === "CHECKING") && "animate-spin")} />
        {status.label}
      </span>
      <span className="hidden text-sm text-muted-foreground sm:inline">{formatLastSynced(state.lastSyncAt, now)}</span>
    </div>
  );
}
