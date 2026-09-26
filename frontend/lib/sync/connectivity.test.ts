import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deriveTerminalStatus, formatLastSynced } from "@/stores/terminal-store";

import { type Connectivity, ConnectivityMonitor } from "./connectivity";

class FakeTarget extends EventTarget {
  visibilityState: DocumentVisibilityState = "visible";
}

function setup(results: boolean[]) {
  const states: Connectivity[] = [];
  const target = new FakeTarget();
  const probe = vi.fn(async () => results.shift() ?? true);
  const monitor = new ConnectivityMonitor({
    probe,
    intervalMs: 15_000,
    timeoutMs: 3_000,
    onChange: (s) => states.push(s),
    eventTarget: target as unknown as Window,
    visibility: target as unknown as Document,
  });
  return { monitor, states, probe, target };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ConnectivityMonitor", () => {
  it("goes online after one successful probe", async () => {
    const { monitor, states } = setup([true]);
    await monitor.check();
    expect(states).toEqual(["online"]);
  });

  it("goes offline only after two consecutive failures", async () => {
    const { monitor, states } = setup([true, false, true, false, false]);
    await monitor.check(); // online
    await monitor.check(); // 1 failure: still online
    expect(monitor.current).toBe("online");
    await monitor.check(); // success resets the counter
    await monitor.check(); // 1 failure
    expect(monitor.current).toBe("online");
    await monitor.check(); // 2 failures
    expect(states).toEqual(["online", "offline"]);
  });

  it("probes on an interval while visible and pauses while hidden", async () => {
    const { monitor, probe, target } = setup([]);
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(probe).toHaveBeenCalledTimes(2);
    target.visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(45_000);
    expect(probe).toHaveBeenCalledTimes(2);
    target.visibilityState = "visible";
    target.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
    expect(probe).toHaveBeenCalledTimes(3);
    monitor.stop();
  });

  it("treats a probe that exceeds the timeout as a failure", async () => {
    const states: Connectivity[] = [];
    const monitor = new ConnectivityMonitor({
      probe: (signal) =>
        new Promise<boolean>((resolve) => signal.addEventListener("abort", () => resolve(false))),
      timeoutMs: 3_000,
      failuresBeforeOffline: 1,
      onChange: (s) => states.push(s),
      eventTarget: new FakeTarget() as unknown as Window,
      visibility: new FakeTarget() as unknown as Document,
    });
    const pending = monitor.check();
    await vi.advanceTimersByTimeAsync(3_000);
    await pending;
    expect(states).toEqual(["offline"]);
  });

  it("reacts to browser offline/online events", async () => {
    const { monitor, states, target } = setup([true, true]);
    monitor.start();
    await vi.advanceTimersByTimeAsync(0);
    target.dispatchEvent(new Event("offline"));
    expect(states).toEqual(["online", "offline"]);
    target.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(states).toEqual(["online", "offline", "online"]);
    monitor.stop();
  });

  it("shares concurrent checks", async () => {
    const { monitor, probe } = setup([true]);
    await Promise.all([monitor.check(), monitor.check(), monitor.check()]);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("deriveTerminalStatus", () => {
  it("prioritizes offline, then errors, then syncing", () => {
    expect(deriveTerminalStatus({ connectivity: "offline", syncActivity: "syncing", pendingCount: 3 })).toEqual({
      kind: "OFFLINE",
      label: "OFFLINE — 3 pending",
    });
    expect(deriveTerminalStatus({ connectivity: "online", syncActivity: "error", pendingCount: 3 }).kind).toBe("SYNC_ERROR");
    expect(deriveTerminalStatus({ connectivity: "online", syncActivity: "syncing", pendingCount: 24 }).label).toBe(
      "SYNCING — 24 pending",
    );
    expect(deriveTerminalStatus({ connectivity: "online", syncActivity: "idle", pendingCount: 0 }).label).toBe("ONLINE");
  });
});

describe("formatLastSynced", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  it("formats relative times", () => {
    expect(formatLastSynced(null, now)).toBe("Never synced");
    expect(formatLastSynced("2026-09-26T09:59:50Z", now)).toBe("Last synced: just now");
    expect(formatLastSynced("2026-09-26T09:58:00Z", now)).toBe("Last synced: 2 minutes ago");
    expect(formatLastSynced("2026-09-26T07:00:00Z", now)).toBe("Last synced: 3 hours ago");
  });
});
