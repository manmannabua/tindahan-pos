/**
 * Schedules sync runs in the background (docs/SYNC_PROTOCOL.md §7):
 * every 10 s while operations are pending, every 60 s otherwise, immediately on reconnect and
 * after each sale. Only one tab syncs at a time (Web Locks); runs never overlap in a tab.
 */
import type { PosDatabase } from "@/lib/db/schema";

import type { SyncEngine, SyncRunResult } from "./engine";
import { countUnsynced } from "./outbox";

export interface SyncRunnerState {
  running: boolean;
  lastResult: SyncRunResult | null;
  lastError: string | null;
}

export interface SyncRunnerOptions {
  db: PosDatabase;
  engine: SyncEngine;
  isOnline: () => boolean;
  onRunStart?: () => void;
  onRunEnd?: (result: SyncRunResult | null, error: string | null) => void;
  activeIntervalMs?: number;
  idleIntervalMs?: number;
  locks?: LockManager | null;
}

export class SyncRunner {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private stopped = true;

  constructor(private readonly options: SyncRunnerOptions) {}

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.options.engine.resetInFlight();
    this.trigger();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Run as soon as possible (coalesces with a run already in progress). */
  trigger(): void {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = this.runLocked().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.trigger();
      } else {
        void this.scheduleNext();
      }
    });
  }

  /** Resolves when the current run (if any) finishes. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async scheduleNext(): Promise<void> {
    if (this.stopped) return;
    const pending = await countUnsynced(this.options.db);
    const delay = pending > 0 ? (this.options.activeIntervalMs ?? 10_000) : (this.options.idleIntervalMs ?? 60_000);
    this.timer = setTimeout(() => this.trigger(), delay);
  }

  private async runLocked(): Promise<void> {
    if (!this.options.isOnline()) return;
    const locks = this.options.locks === undefined ? (globalThis.navigator?.locks ?? null) : this.options.locks;
    if (!locks) {
      await this.runOnce();
      return;
    }
    // ifAvailable: if another tab holds the lock it is syncing for us; skip this round.
    await locks.request("pos-sync", { ifAvailable: true }, async (lock) => {
      if (lock) await this.runOnce();
    });
  }

  private async runOnce(): Promise<void> {
    this.options.onRunStart?.();
    try {
      const result = await this.options.engine.run();
      this.options.onRunEnd?.(result, result.transientError);
    } catch (error) {
      this.options.onRunEnd?.(null, error instanceof Error ? error.message : String(error));
    }
  }
}
