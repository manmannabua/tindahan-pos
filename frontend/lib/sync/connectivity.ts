/**
 * Server reachability monitor. See docs/OFFLINE_ARCHITECTURE.md §6.
 *
 * `navigator.onLine` only says a network interface is up, not that the API is reachable, so we
 * probe `GET /api/v1/health`: online after one success, offline after two consecutive failures.
 * Browser `online`/`offline` events are used as fast hints.
 */

export type Connectivity = "unknown" | "online" | "offline";

export interface ConnectivityMonitorOptions {
  /** Resolve true if the server answered. Must respect the abort signal. */
  probe?: (signal: AbortSignal) => Promise<boolean>;
  intervalMs?: number;
  timeoutMs?: number;
  failuresBeforeOffline?: number;
  onChange: (state: Connectivity) => void;
  /** Where `online`/`offline`/`visibilitychange` events come from (window/document by default). */
  eventTarget?: Pick<Window, "addEventListener" | "removeEventListener">;
  visibility?: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
}

export async function probeHealth(signal: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch("/api/v1/health", { cache: "no-store", signal });
    return response.ok;
  } catch {
    return false;
  }
}

export class ConnectivityMonitor {
  private state: Connectivity = "unknown";
  private failures = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private inflight: Promise<void> | null = null;
  private readonly probe: (signal: AbortSignal) => Promise<boolean>;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly failuresBeforeOffline: number;

  constructor(private readonly options: ConnectivityMonitorOptions) {
    this.probe = options.probe ?? probeHealth;
    this.intervalMs = options.intervalMs ?? 15_000;
    this.timeoutMs = options.timeoutMs ?? 3_000;
    this.failuresBeforeOffline = options.failuresBeforeOffline ?? 2;
  }

  get current(): Connectivity {
    return this.state;
  }

  start(): void {
    if (this.interval) return;
    this.events?.addEventListener("online", this.handleOnline);
    this.events?.addEventListener("offline", this.handleOffline);
    this.visibility?.addEventListener("visibilitychange", this.handleVisibility);
    this.interval = setInterval(() => {
      if (this.visibility?.visibilityState === "hidden") return;
      void this.check();
    }, this.intervalMs);
    void this.check();
  }

  stop(): void {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.events?.removeEventListener("online", this.handleOnline);
    this.events?.removeEventListener("offline", this.handleOffline);
    this.visibility?.removeEventListener("visibilitychange", this.handleVisibility);
  }

  /** Probe now. Concurrent calls share one probe. */
  check(): Promise<void> {
    this.inflight ??= this.runProbe().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async runProbe(): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let ok = false;
    try {
      ok = await this.probe(controller.signal);
    } catch {
      ok = false;
    } finally {
      clearTimeout(timer);
    }
    if (ok) {
      this.failures = 0;
      this.set("online");
    } else {
      this.failures += 1;
      if (this.failures >= this.failuresBeforeOffline) this.set("offline");
    }
  }

  private set(state: Connectivity): void {
    if (state === this.state) return;
    this.state = state;
    this.options.onChange(state);
  }

  private get events() {
    return this.options.eventTarget ?? (typeof window !== "undefined" ? window : undefined);
  }

  private get visibility() {
    return this.options.visibility ?? (typeof document !== "undefined" ? document : undefined);
  }

  private readonly handleOnline = () => {
    void this.check();
  };

  private readonly handleOffline = () => {
    // No network interface at all: certainly offline.
    this.failures = this.failuresBeforeOffline;
    this.set("offline");
  };

  private readonly handleVisibility = () => {
    if (this.visibility?.visibilityState === "visible") void this.check();
  };
}
