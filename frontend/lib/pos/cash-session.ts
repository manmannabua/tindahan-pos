/**
 * Cash drawer sessions (shifts), recorded locally and synced via the outbox.
 *
 * Expected cash mirrors the server (backend sync/handlers.py `expected_cash`):
 *   opening float + cash applied to completed sales + cash in − cash out − pickups − cash refunds
 * ("applied" = the part of the payment that pays the sale; change handed back is excluded).
 * Voided sales are excluded; refunds count in the session the return was made in.
 */
import { v7 as uuidv7 } from "uuid";

import type {
  CashMovementType,
  LocalCashMovement,
  LocalCashSession,
  PosDatabase,
} from "@/lib/db/schema";
import { add, subtract, toMoneyString } from "@/lib/money";
import { enqueue, PRIORITY } from "@/lib/sync/outbox";
import type { CashMovementPayload, CashSessionClosePayload, CashSessionOpenPayload } from "@/types/sync";

export async function getOpenSession(db: PosDatabase): Promise<LocalCashSession | undefined> {
  return db.cashSessions.where("status").equals("OPEN").first();
}

export async function openCashSession(
  db: PosDatabase,
  args: { deviceId: string; userId: string; openingFloat: string; now?: Date },
): Promise<LocalCashSession> {
  const now = (args.now ?? new Date()).toISOString();
  return db.transaction("rw", db.cashSessions, db.outbox, async () => {
    if (await getOpenSession(db)) throw new Error("A cash session is already open on this terminal");
    const session: LocalCashSession = {
      id: uuidv7(),
      status: "OPEN",
      openedBy: args.userId,
      openedAt: now,
      openingFloat: toMoneyString(args.openingFloat),
      closedBy: null,
      closedAt: null,
      countedCash: null,
      expectedCash: null,
      overShort: null,
      note: null,
    };
    await db.cashSessions.add(session);
    const payload: CashSessionOpenPayload = {
      id: session.id,
      opened_by_id: session.openedBy,
      opened_at: now,
      opening_float: session.openingFloat,
    };
    await enqueue(db, {
      deviceId: args.deviceId,
      entityType: "cash_session",
      entityId: session.id,
      operation: "cash_session.open",
      payload,
      priority: PRIORITY.CASH_SESSION_OPEN,
      now: args.now,
    });
    return session;
  });
}

export async function recordCashMovement(
  db: PosDatabase,
  args: {
    deviceId: string;
    sessionId: string;
    type: CashMovementType;
    amount: string;
    reason: string | null;
    userId: string;
    authorizedById: string | null;
    now?: Date;
  },
): Promise<LocalCashMovement> {
  const now = (args.now ?? new Date()).toISOString();
  const movement: LocalCashMovement = {
    id: uuidv7(),
    cashSessionId: args.sessionId,
    movementType: args.type,
    amount: toMoneyString(args.amount),
    reason: args.reason,
    userId: args.userId,
    authorizedById: args.authorizedById,
    occurredAt: now,
  };
  const payload: CashMovementPayload = {
    id: movement.id,
    cash_session_id: movement.cashSessionId,
    movement_type: movement.movementType,
    amount: movement.amount,
    reason: movement.reason,
    user_id: movement.userId,
    authorized_by_id: movement.authorizedById,
    occurred_at: now,
  };
  await db.transaction("rw", db.cashMovements, db.outbox, async () => {
    await db.cashMovements.add(movement);
    await enqueue(db, {
      deviceId: args.deviceId,
      entityType: "cash_movement",
      entityId: movement.id,
      operation: "cash_movement.record",
      payload,
      priority: PRIORITY.CASH,
      now: args.now,
    });
  });
  return movement;
}

export interface SessionSummary {
  session: LocalCashSession;
  saleCount: number;
  salesTotal: string;
  byMethod: { name: string; kind: string; amount: string; count: number }[];
  cashSales: string;
  cashIn: string;
  cashOut: string;
  pickups: string;
  cashRefunds: string;
  returnCount: number;
  voidCount: number;
  expectedCash: string;
}

export async function summarizeSession(db: PosDatabase, sessionId: string): Promise<SessionSummary> {
  const session = await db.cashSessions.get(sessionId);
  if (!session) throw new Error("Cash session not found");
  const allSales = await db.sales.where("cashSessionId").equals(sessionId).toArray();
  const sales = allSales.filter((s) => s.status === "COMPLETED");
  const returns = await db.returns.where("cashSessionId").equals(sessionId).toArray();
  const refunds = await db.refunds.where("returnId").anyOf(returns.map((r) => r.id)).toArray();
  const cashRefunds = toMoneyString(add(...refunds.filter((r) => r.methodKind === "CASH").map((r) => r.amount)));
  const payments = (await db.payments.where("saleId").anyOf(sales.map((s) => s.id)).toArray());
  const movements = await db.cashMovements.where("cashSessionId").equals(sessionId).toArray();

  const methods = new Map<string, { name: string; kind: string; amount: string; count: number }>();
  for (const p of payments) {
    const entry = methods.get(p.paymentMethodId) ?? { name: p.methodName, kind: p.methodKind, amount: "0.00", count: 0 };
    entry.amount = toMoneyString(add(entry.amount, p.amount));
    entry.count += 1;
    methods.set(p.paymentMethodId, entry);
  }
  const sumOf = (type: CashMovementType) =>
    toMoneyString(add(...movements.filter((m) => m.movementType === type).map((m) => m.amount)));
  const cashSales = toMoneyString(add(...payments.filter((p) => p.methodKind === "CASH").map((p) => p.amount)));
  const cashIn = sumOf("CASH_IN");
  const cashOut = sumOf("CASH_OUT");
  const pickups = sumOf("PICKUP");
  return {
    session,
    saleCount: sales.length,
    salesTotal: toMoneyString(add(...sales.map((s) => s.total))),
    byMethod: [...methods.values()],
    cashSales,
    cashIn,
    cashOut,
    pickups,
    cashRefunds,
    returnCount: returns.length,
    voidCount: allSales.length - sales.length,
    expectedCash: toMoneyString(
      subtract(subtract(subtract(add(session.openingFloat, cashSales, cashIn), cashOut), pickups), cashRefunds),
    ),
  };
}

export async function closeCashSession(
  db: PosDatabase,
  args: { deviceId: string; sessionId: string; userId: string; countedCash: string; note: string | null; now?: Date },
): Promise<SessionSummary> {
  const now = (args.now ?? new Date()).toISOString();
  return db.transaction("rw", [db.cashSessions, db.sales, db.payments, db.cashMovements, db.returns, db.refunds, db.outbox], async () => {
    const summary = await summarizeSession(db, args.sessionId);
    if (summary.session.status !== "OPEN") throw new Error("Cash session is already closed");
    const counted = toMoneyString(args.countedCash);
    const overShort = toMoneyString(subtract(counted, summary.expectedCash));
    const closed: LocalCashSession = {
      ...summary.session,
      status: "CLOSED",
      closedBy: args.userId,
      closedAt: now,
      countedCash: counted,
      expectedCash: summary.expectedCash,
      overShort,
      note: args.note,
    };
    await db.cashSessions.put(closed);
    const payload: CashSessionClosePayload = {
      id: closed.id,
      closed_by_id: args.userId,
      closed_at: now,
      counted_cash: counted,
      expected_cash: summary.expectedCash,
      over_short: overShort,
      note: args.note,
    };
    await enqueue(db, {
      deviceId: args.deviceId,
      entityType: "cash_session",
      entityId: closed.id,
      operation: "cash_session.close",
      payload,
      priority: PRIORITY.CASH,
      now: args.now,
    });
    return { ...summary, session: closed };
  });
}
