"use client";

import { RefreshCwIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLiveQuery } from "@/hooks/use-live-query";
import { getDb, type OutboxEntry } from "@/lib/db/schema";
import { describeSyncError } from "@/lib/sync/error-messages";
import { triggerSync } from "@/lib/sync/service";
import { formatLastSynced, useTerminalStore } from "@/stores/terminal-store";

/** Outbox status for this terminal: what hasn't reached the server and why. */
export function SyncMonitor() {
  const ops = useLiveQuery(
    async () => (await getDb().outbox.where("status").anyOf("PENDING", "SYNCING", "FAILED", "CONFLICT").toArray()).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0)),
    [],
    null as OutboxEntry[] | null, // null until IndexedDB answers: never claim "synced" before we know
  );
  const syncedCount = useLiveQuery(() => getDb().outbox.where("status").equals("SYNCED").count(), [], 0);
  const lastSyncAt = useTerminalStore((s) => s.lastSyncAt);
  const syncError = useTerminalStore((s) => s.syncError);

  const retryNow = async () => {
    // Clear backoff so everything pending is due immediately.
    await getDb().outbox.where("status").equals("PENDING").modify({ nextAttemptAt: null });
    triggerSync();
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">Sync</h1>
        <span className="text-sm text-muted-foreground">
          {formatLastSynced(lastSyncAt)} · {syncedCount} synced
        </span>
        <Button className="ml-auto h-11" onClick={() => void retryNow()}>
          <RefreshCwIcon /> Sync now
        </Button>
      </div>
      {syncError && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{syncError}</p>}
      <ul className="divide-y rounded-xl border bg-background" aria-label="Unsynced operations">
        {(ops ?? []).map((op) => (
          <li key={op.operationId} className="space-y-1 px-4 py-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{op.operation}</span>
              <Badge variant={op.status === "FAILED" || op.status === "CONFLICT" ? "destructive" : "outline"}>{op.status}</Badge>
              <span className="ml-auto text-xs text-muted-foreground">
                {new Date(op.createdAt).toLocaleString()} · attempts {op.attemptCount}
              </span>
            </div>
            {op.error && op.status !== "SYNCING" && (
              <div className="text-xs text-destructive" data-testid="op-error">
                {describeSyncError(op.error)} <span className="text-muted-foreground">({op.error.code})</span>
              </div>
            )}
            {op.nextAttemptAt && op.status === "PENDING" && (
              <div className="text-xs text-muted-foreground">Next attempt {new Date(op.nextAttemptAt).toLocaleTimeString()}</div>
            )}
          </li>
        ))}
        {ops === null && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Checking…</li>}
        {ops !== null && ops.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Everything is synced.</li>}
      </ul>
    </div>
  );
}
