/**
 * Local outbox. See docs/SYNC_PROTOCOL.md §2.
 *
 * `enqueue` must be called inside the same Dexie transaction that writes the business records,
 * so a record without its outbox entry (or vice versa) can never exist.
 */
import { v7 as uuidv7 } from "uuid";

import type { OutboxEntry, PosDatabase } from "@/lib/db/schema";

/**
 * Lower is sent first. Dependencies before dependents (a sale references its cash session and
 * possibly a customer created offline). See docs/SYNC_PROTOCOL.md §2.
 */
export const PRIORITY = {
  CASH_SESSION_OPEN: 5,
  CUSTOMER: 8,
  SALE: 10,
  VOID: 15,
  PAYMENT: 20,
  INVENTORY: 30,
  CASH: 40,
  RETURN: 50,
  OTHER: 60,
} as const;

export interface EnqueueArgs {
  deviceId: string;
  entityType: string;
  entityId: string;
  operation: string;
  payload: unknown;
  priority: number;
  now?: Date;
}

export async function enqueue(db: PosDatabase, args: EnqueueArgs): Promise<OutboxEntry> {
  const entry: OutboxEntry = {
    operationId: uuidv7(),
    deviceId: args.deviceId,
    entityType: args.entityType,
    entityId: args.entityId,
    operation: args.operation,
    payload: args.payload,
    priority: args.priority,
    createdAt: (args.now ?? new Date()).toISOString(),
    attemptCount: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    status: "PENDING",
    error: null,
    syncedAt: null,
  };
  entry.seq = await db.outbox.add(entry);
  return entry;
}

/** Operations waiting to reach the server (PENDING or in flight). */
export function countUnsynced(db: PosDatabase): Promise<number> {
  return db.outbox.where("status").anyOf("PENDING", "SYNCING").count();
}
