"use client";

import { useEffect } from "react";

import { ConnectivityMonitor } from "@/lib/sync/connectivity";
import { useTerminalStore } from "@/stores/terminal-store";

/** Runs the server reachability monitor while mounted and mirrors it into the terminal store. */
export function useConnectivityMonitor(): void {
  useEffect(() => {
    const monitor = new ConnectivityMonitor({
      onChange: (state) => useTerminalStore.getState().setConnectivity(state),
    });
    monitor.start();
    return () => monitor.stop();
  }, []);
}
