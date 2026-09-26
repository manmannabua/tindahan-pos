import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NetworkError } from "@/lib/api/errors";
import { getMeta } from "@/lib/db/meta";
import type { PosDatabase } from "@/lib/db/schema";
import { addItem, EMPTY_CART } from "@/lib/pos/cart";
import { completeSale } from "@/lib/pos/complete-sale";
import { coke, createTerminalDb, destroyDb, IDS, PRICE_CONTEXT } from "@/test-utils/terminal-fixture";
import type { OpStatus, PullResponse, PushRequest, PushResponse } from "@/types/sync";

import { backoffMs, SyncEngine, type SyncTransport } from "./engine";
import { enqueue } from "./outbox";

let db: PosDatabase;
let clock: Date;

beforeEach(async () => {
  db = await createTerminalDb();
  clock = new Date("2026-09-26T08:00:00Z");
});
afterEach(async () => {
  await destroyDb(db);
});

const emptyPull = (cursor = "c2"): PullResponse => ({
  changes: {},
  staff: null,
  counts: null,
  next_cursor: cursor,
  has_more: false,
  server_time: clock.toISOString(),
});

function transport(statuses: (req: PushRequest) => OpStatus[], pull: () => PullResponse = () => emptyPull()) {
  const pushes: PushRequest[] = [];
  const t: SyncTransport = {
    push: vi.fn(async (req: PushRequest): Promise<PushResponse> => {
      pushes.push(req);
      const s = statuses(req);
      return {
        results: req.operations.map((op, i) => ({
          operation_id: op.operation_id,
          status: s[i] ?? "APPLIED",
          error: s[i] === "APPLIED" || s[i] === "DUPLICATE" ? null : { code: `x.${s[i]?.toLowerCase()}`, message: String(s[i]) },
          result: null,
        })),
        server_time: clock.toISOString(),
      };
    }),
    pull: vi.fn(async () => pull()),
  };
  return { t, pushes };
}

const engine = (t: SyncTransport) => new SyncEngine({ db, transport: t, now: () => clock, random: () => 0.5 });

async function sell(): Promise<string> {
  const cash = await db.paymentMethods.get(IDS.cash);
  if (!cash) throw new Error("no cash");
  const { sale } = await completeSale(db, {
    cart: addItem(EMPTY_CART, await coke(db), PRICE_CONTEXT),
    tenders: [{ method: cash, amount: "75.00" }],
    cashier: { id: IDS.cashier, name: "Cathy" },
    cashSessionId: null,
    priceLevelId: IDS.retail,
    pricesIncludeTax: true,
    deviceId: IDS.device,
    receiptPrefix: "MAIN-T01-",
    stockLocationId: IDS.location,
    now: clock,
  });
  return sale.id;
}

async function op(operation: string, priority: number, entityType = "cash_session") {
  return enqueue(db, { deviceId: IDS.device, entityType, entityId: crypto.randomUUID(), operation, payload: {}, priority, now: clock });
}

describe("SyncEngine push", () => {
  it("sends due operations by priority and marks acknowledgments synced", async () => {
    const saleId = await sell();
    await op("cash_session.open", 5);
    const { t, pushes } = transport(() => ["APPLIED", "DUPLICATE"]);
    const result = await engine(t).run();

    expect(pushes[0].operations.map((o) => o.operation)).toEqual(["cash_session.open", "sale.complete"]);
    expect(pushes[0].pending_count).toBe(2);
    expect(result).toMatchObject({ synced: 2, transientError: null, pulled: true });
    expect(await db.outbox.where("status").equals("SYNCED").count()).toBe(2);
    expect((await db.sales.get(saleId))?.syncStatus).toBe("SYNCED");
    expect(await getMeta(db, "lastSyncAt")).toBe(clock.toISOString());
  });

  it("DEFERRED waits without failing; REJECTED/CONFLICT need attention", async () => {
    await op("a", 10);
    await op("b", 10);
    await op("c", 10);
    const { t } = transport(() => ["DEFERRED", "REJECTED", "CONFLICT"]);
    const result = await engine(t).run();
    const rows = await db.outbox.orderBy("seq").toArray();
    expect(rows.map((r) => r.status)).toEqual(["PENDING", "FAILED", "CONFLICT"]);
    expect(rows[0].nextAttemptAt! > clock.toISOString()).toBe(true);
    expect(rows[1].error?.code).toBe("x.rejected");
    expect(result).toMatchObject({ deferred: 1, failed: 2 });
  });

  it("network failure puts the batch back with exponential backoff and skips the pull", async () => {
    await op("a", 10);
    const t: SyncTransport = { push: vi.fn().mockRejectedValue(new NetworkError()), pull: vi.fn() };
    const result = await engine(t).run();
    expect(result.transientError).toBe("Server unreachable");
    expect(t.pull).not.toHaveBeenCalled();
    const [row] = await db.outbox.toArray();
    expect(row).toMatchObject({ status: "PENDING", attemptCount: 1 });
    expect(new Date(row.nextAttemptAt!).getTime() - clock.getTime()).toBe(backoffMs(1, () => 0.5));

    // Not due yet → nothing is sent.
    const second = await engine(t).run();
    expect(t.push).toHaveBeenCalledTimes(1);
    expect(second.pushed).toBe(0);

    // After the backoff it is retried.
    clock = new Date(clock.getTime() + 60_000);
    const { t: ok } = transport(() => ["APPLIED"]);
    expect((await engine(ok).run()).synced).toBe(1);
  });

  it("RETRY stops pushing and backs off", async () => {
    await op("a", 10);
    const { t } = transport(() => ["RETRY"]);
    const result = await engine(t).run();
    expect(result.transientError).toBeTruthy();
    expect((await db.outbox.toArray())[0]).toMatchObject({ status: "PENDING", attemptCount: 1 });
  });

  it("backoff grows to five minutes", () => {
    expect(backoffMs(1, () => 0.5)).toBe(2000);
    expect(backoffMs(3, () => 0.5)).toBe(8000);
    expect(backoffMs(30, () => 0.5)).toBe(300_000);
    expect(backoffMs(1, () => 0)).toBe(1000);
  });

  it("resets operations left SYNCING by a crash", async () => {
    const entry = await op("a", 10);
    await db.outbox.update(entry.seq as number, { status: "SYNCING" });
    expect(await engine(transport(() => []).t).resetInFlight()).toBe(1);
    expect((await db.outbox.toArray())[0].status).toBe("PENDING");
  });

  it("a lost acknowledgment is resent and accepted as DUPLICATE", async () => {
    await sell();
    const lost: SyncTransport = { push: vi.fn().mockRejectedValue(new NetworkError()), pull: vi.fn() };
    await engine(lost).run();
    clock = new Date(clock.getTime() + 60_000);
    const { t, pushes } = transport(() => ["DUPLICATE"]);
    await engine(t).run();
    expect(pushes[0].operations).toHaveLength(1);
    expect((await db.outbox.toArray())[0].status).toBe("SYNCED");
  });
});

describe("SyncEngine pull + reconciliation", () => {
  it("drops provisional movements once a pass after the acknowledgment brings the server balance", async () => {
    await sell(); // local: 10 - 1 = 9
    expect((await db.inventory.get([IDS.location, IDS.cokeVariant]))?.quantity).toBe("9");

    const balanceAfterSale: PullResponse = {
      ...emptyPull("c3"),
      changes: { inventory_balances: [{ stock_location_id: IDS.location, variant_id: IDS.cokeVariant, quantity: "9.000", updated_at: clock.toISOString() }] },
    };
    const { t } = transport(
      () => ["APPLIED"],
      () => balanceAfterSale,
    );
    // The ack happens at `clock`; the pull pass starts a moment later.
    let tick = 0;
    const e = new SyncEngine({ db, transport: t, now: () => new Date(clock.getTime() + tick++), random: () => 0.5 });
    await e.run();

    expect(await db.inventoryMovements.count()).toBe(0);
    const row = await db.inventory.get([IDS.location, IDS.cokeVariant]);
    expect(row).toMatchObject({ serverQuantity: "9.000", quantity: "9" });
    expect(await getMeta(db, "pullCursor")).toBe("c3");
  });

  it("keeps provisional movements of unsynced sales on top of new server balances", async () => {
    await sell();
    const failing: SyncTransport = {
      push: vi.fn().mockRejectedValue(new NetworkError()),
      pull: vi.fn(),
    };
    await engine(failing).run();
    // Meanwhile another terminal sold 3: the server balance is 7 (our sale not included yet).
    await new SyncEngine({
      db,
      transport: transport(() => [], () => ({
        ...emptyPull(),
        changes: { inventory_balances: [{ stock_location_id: IDS.location, variant_id: IDS.cokeVariant, quantity: "7.000", updated_at: clock.toISOString() }] },
      })).t,
      now: () => clock,
    }).pullAll();
    expect((await db.inventory.get([IDS.location, IDS.cokeVariant]))?.quantity).toBe("6");
    expect(await db.inventoryMovements.count()).toBe(1);
  });

  it("follows pages until has_more is false and resumes a pass", async () => {
    const pages = [
      { ...emptyPull("p1"), has_more: true },
      { ...emptyPull("p2"), has_more: false },
    ];
    const cursors: (string | null)[] = [];
    const t: SyncTransport = {
      push: vi.fn(),
      pull: vi.fn(async (cursor: string | null) => {
        cursors.push(cursor);
        return pages.shift() ?? emptyPull();
      }),
    };
    await engine(t).pullAll();
    expect(cursors).toEqual([null, "p1"]);
    expect(await getMeta(db, "pullMidPass")).toBe(false);
  });
});

describe("SyncEngine.resetBackoff", () => {
  it("makes backed-off operations due immediately (reconnect)", async () => {
    await op("a", 10);
    const failing: SyncTransport = { push: vi.fn().mockRejectedValue(new NetworkError()), pull: vi.fn() };
    const e = engine(failing);
    await e.run();
    expect(await e.dueOperations(10)).toHaveLength(0);
    expect(await e.resetBackoff()).toBe(1);
    expect(await e.dueOperations(10)).toHaveLength(1);
  });
});
