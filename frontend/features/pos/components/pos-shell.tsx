"use client";

import { ReceiptTextIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ConnectivityBadge } from "@/features/sync/components/connectivity-badge";
import { useConnectivityMonitor } from "@/features/sync/hooks/use-connectivity-monitor";

/**
 * POS frame: no admin navigation, no server data. Everything under /pos must work with the
 * network down once the terminal is initialized (docs/OFFLINE_ARCHITECTURE.md).
 */
export function PosShell({ children }: { children: ReactNode }) {
  useConnectivityMonitor();
  return (
    <div className="flex min-h-svh flex-1 flex-col bg-muted/30">
      <header className="flex h-16 items-center gap-3 border-b bg-background px-4">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <ReceiptTextIcon className="size-5" />
        </span>
        <span className="text-lg font-semibold">POS</span>
        <ConnectivityBadge className="ml-auto" />
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
