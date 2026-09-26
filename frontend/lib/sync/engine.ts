/**
 * Sync engine: push the outbox, pull server changes, reconcile inventory.
 * See docs/SYNC_PROTOCOL.md. Plain TS class with injected transport/clock so it is testable and
 * could move into a Web Worker. It never throws to its caller for network problems: failures
 * become outbox state + a status the UI shows.
 */
import { ApiError, NetworkError } from "@/lib/api/errors";
import { getMeta, setMeta } from "@/lib/db/meta";
import type { OutboxEntry, PosDatabase } from "@/lib/db/schema";
import type { OperationResult, PullResponse, PushRequest, PushResponse } from "@/types/sync";

import { countUnsynced } from "./outbox";
import { applyPullPage } from "./pull-applier";
import { dropCountedMovements } from "./reconcile";

/** Movement type whose provisional rows an acknowledged operation brings into the server ledger. */
const ACKED_MOVEMENT_TYPE: Record<string, string> = {
  "sale.complete": "SALE",
  "sale.void": "SALE_VOID",
  "return.create": "SALE_RETURN",
};

export interface SyncTransport {
  push: (request: PushRequest) => Promise<PushResponse>;
  pull: (cursor: string | null, limit: number) => Promise<PullResponse>;
}

export interface SyncEngineOptions {
  db: PosDatabase;
  transport: SyncTransport;
  appVersion?: string;
  now?: () => Date;
  random?: () => number;
  batchSize?: number;
  pullLimit?: number;
  onPullPage?: (page: PullResponse) => void;
}

export interface SyncRunResult {
  pushed: number;
  synced: number;
  failed: number;
  deferred: number;
  /** True if a network/server problem stopped the run (will retry with backoff). */
  transientError: string | null;
  pulled: boolean;
}

const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** 2 s, 4 s, 8 s … capped at 5 min, with ±50 % jitter so terminals don't retry in lockstep. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.5 + random()));
}

function describe(error: unknown): string {
  if (error instanceof ApiError) return `${error.status} ${error.message}`;
  if (error instanceof NetworkError) return "Server unreachable";
  return error instanceof Error ? error.message : String(error);
}

export class SyncEngine {
  private readonly db: PosDatabase;
  private readonly now: () => Date;
  private readonly random: () => number;
  private readonly batchSize: number;
  private readonly pullLimit: number;

  constructor(private readonly options: SyncEngineOptions) {
    this.db = options.db;
    this.now = options.now ?? (() => new Date());
    this.random = options.random ?? Math.random;
    this.batchSize = options.batchSize ?? 100;
    this.pullLimit = options.pullLimit ?? 1000;
  }

  /**
   * On start: operations left SYNCING by a crash/closed tab have an unknown outcome. Resending is
   * safe (the server is idempotent), so they go back to PENDING.
   */
  async resetInFlight(): Promise<number> {
    return this.db.outbox.where("status").equals("SYNCING").modify({ status: "PENDING", nextAttemptAt: null });
  }

  /**
   * Make every pending operation due now. Called when the server becomes reachable again: backoff
   * exists to avoid hammering an unreachable server, not to delay sync after it returns.
   */
  async resetBackoff(): Promise<number> {
    return this.db.outbox.where("status").equals("PENDING").modify({ nextAttemptAt: null });
  }

  async run(): Promise<SyncRunResult> {
    const result: SyncRunResult = { pushed: 0, synced: 0, failed: 0, deferred: 0, transientError: null, pulled: false };
    try {
      await this.pushAll(result);
    } catch (error) {
      result.transientError = describe(error);
    }
    if (result.transientError) return result; // server unreachable: don't try pulling now
    try {
      await this.pullAll();
      result.pulled = true;
      await setMeta(this.db, "lastSyncAt", this.now().toISOString());
    } catch (error) {
      result.transientError = describe(error);
    }
    return result;
  }

  /** Operations due now, in (priority, seq) order. */
  async dueOperations(limit: number): Promise<OutboxEntry[]> {
    const nowIso = this.now().toISOString();
    return this.db.outbox
      .where("[status+priority+seq]")
      .between(["PENDING", -Infinity, -Infinity], ["PENDING", Infinity, Infinity])
      .filter((op) => !op.nextAttemptAt || op.nextAttemptAt <= nowIso)
      .limit(limit)
      .toArray();
  }

  private async pushAll(result: SyncRunResult): Promise<void> {
    for (;;) {
      const batch = await this.dueOperations(this.batchSize);
      if (batch.length === 0) return;
      const seqs = batch.map((op) => op.seq as number);
      const attemptAt = this.now().toISOString();
      await this.db.outbox.where("seq").anyOf(seqs).modify({ status: "SYNCING", lastAttemptAt: attemptAt });

      let response: PushResponse;
      try {
        response = await this.options.transport.push({
          operations: batch.map((op) => ({
            operation_id: op.operationId,
            entity_type: op.entityType,
            entity_id: op.entityId,
            operation: op.operation,
            created_at: op.createdAt,
            payload: op.payload,
          })),
          pending_count: await countUnsynced(this.db),
          app_version: this.options.appVersion,
          device_time: attemptAt,
        });
      } catch (error) {
        await this.retryLater(batch, { code: "sync.transport", message: describe(error) });
        throw error;
      }

      result.pushed += batch.length;
      const byId = new Map(response.results.map((r) => [r.operation_id, r]));
      let transient = false;
      for (const op of batch) {
        const outcome = byId.get(op.operationId);
        if (!outcome) {
          transient = true;
          await this.retryLater([op], { code: "sync.no_result", message: "No result from server" });
          continue;
        }
        transient = (await this.applyResult(op, outcome, result)) || transient;
      }
      if (transient) throw new Error("Server asked to retry later");
    }
  }

  /** Returns true if the outcome is transient (stop pushing for now). */
  private async applyResult(op: OutboxEntry, outcome: OperationResult, result: SyncRunResult): Promise<boolean> {
    const nowIso = this.now().toISOString();
    const error = outcome.error ? { code: outcome.error.code, message: outcome.error.message } : null;
    switch (outcome.status) {
      case "APPLIED":
      case "DUPLICATE":
        result.synced += 1;
        await this.db.transaction(
          "rw",
          [this.db.outbox, this.db.sales, this.db.returns, this.db.inventoryMovements],
          async () => {
            await this.db.outbox.update(op.seq as number, { status: "SYNCED", syncedAt: nowIso, error: null });
            if (op.operation === "sale.complete") await this.db.sales.update(op.entityId, { syncStatus: "SYNCED" });
            if (op.operation === "return.create") await this.db.returns.update(op.entityId, { syncStatus: "SYNCED" });
            // Only the movements this operation carries are now in the server ledger (a sale and
            // its later void share the sale id as reference).
            const movementType = ACKED_MOVEMENT_TYPE[op.operation];
            if (movementType) {
              await this.db.inventoryMovements
                .where("referenceId")
                .equals(op.entityId)
                .filter((m) => m.movementType === movementType)
                .modify({ ackedAt: nowIso });
            }
          },
        );
        return false;
      case "DEFERRED":
        // A dependency hasn't reached the server yet: not a failure, just not yet.
        result.deferred += 1;
        await this.db.outbox.update(op.seq as number, {
          status: "PENDING",
          attemptCount: op.attemptCount + 1,
          nextAttemptAt: new Date(this.now().getTime() + backoffMs(op.attemptCount + 1, this.random)).toISOString(),
          error,
        });
        return false;
      case "REJECTED":
      case "CONFLICT": {
        result.failed += 1;
        const status = outcome.status === "REJECTED" ? "FAILED" : "CONFLICT";
        await this.db.transaction("rw", this.db.outbox, this.db.sales, this.db.returns, async () => {
          await this.db.outbox.update(op.seq as number, { status, attemptCount: op.attemptCount + 1, error });
          if (op.operation === "sale.complete") await this.db.sales.update(op.entityId, { syncStatus: status });
          if (op.operation === "return.create") await this.db.returns.update(op.entityId, { syncStatus: status });
        });
        return false;
      }
      case "RETRY":
      default:
        await this.retryLater([op], error ?? { code: "sync.retry", message: "Server asked to retry" });
        return true;
    }
  }

  private async retryLater(ops: OutboxEntry[], error: { code: string; message: string }): Promise<void> {
    const now = this.now().getTime();
    await this.db.transaction("rw", this.db.outbox, async () => {
      for (const op of ops) {
        const attempt = op.attemptCount + 1;
        await this.db.outbox.update(op.seq as number, {
          status: "PENDING",
          attemptCount: attempt,
          nextAttemptAt: new Date(now + backoffMs(attempt, this.random)).toISOString(),
          error,
        });
      }
    });
  }

  /** Follow pull pages until the pass is complete, then drop provisional movements it covered. */
  async pullAll(): Promise<void> {
    let cursor = (await getMeta(this.db, "pullCursor")) ?? null;
    let passStartedAt = await getMeta(this.db, "pullPassStartedAt");
    for (;;) {
      const midPass = (await getMeta(this.db, "pullMidPass")) === true;
      if (!midPass || !passStartedAt) {
        passStartedAt = this.now().toISOString();
        await setMeta(this.db, "pullPassStartedAt", passStartedAt);
      }
      const page = await this.options.transport.pull(cursor, this.pullLimit);
      await applyPullPage(this.db, page, this.now());
      cursor = page.next_cursor;
      await setMeta(this.db, "pullCursor", cursor);
      await setMeta(this.db, "pullMidPass", page.has_more);
      this.options.onPullPage?.(page);
      if (!page.has_more) break;
    }
    await setMeta(this.db, "lastPullCompletedAt", this.now().toISOString());
    await dropCountedMovements(this.db, passStartedAt);
  }
}
