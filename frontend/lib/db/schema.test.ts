import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type OutboxEntry, PosDatabase } from "./schema";

let db: PosDatabase;

beforeEach(async () => {
  db = new PosDatabase(`test-${crypto.randomUUID()}`);
  await db.open();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

function outbox(operationId: string, priority: number, status: OutboxEntry["status"] = "PENDING"): OutboxEntry {
  return {
    operationId,
    deviceId: "dev",
    entityType: "sale",
    entityId: operationId,
    operation: "sale.complete",
    payload: {},
    priority,
    createdAt: new Date().toISOString(),
    attemptCount: 0,
    lastAttemptAt: null,
    nextAttemptAt: null,
    status,
    error: null,
    syncedAt: null,
  };
}

describe("PosDatabase v1", () => {
  it("looks up barcodes by the unique code index", async () => {
    await db.barcodes.bulkAdd([
      { id: "b1", code: "4800361419116", variantId: "v1", productUnitId: "u1", symbology: "EAN13", isPrimary: true, isActive: true },
      { id: "b2", code: "036000291452", variantId: "v2", productUnitId: "u2", symbology: "UPCA", isPrimary: true, isActive: true },
    ]);
    const found = await db.barcodes.where("code").equals("036000291452").first();
    expect(found?.variantId).toBe("v2");
    await expect(
      db.barcodes.add({ id: "b3", code: "036000291452", variantId: "v3", productUnitId: "u3", symbology: "OTHER", isPrimary: false, isActive: true }),
    ).rejects.toThrow();
  });

  it("orders pending outbox entries by priority then sequence", async () => {
    await db.outbox.bulkAdd([outbox("op-a", 40), outbox("op-b", 10), outbox("op-c", 10), outbox("op-d", 5, "SYNCED")]);
    const pending = await db.outbox
      .where("[status+priority+seq]")
      .between(["PENDING", -Infinity, -Infinity], ["PENDING", Infinity, Infinity])
      .toArray();
    expect(pending.map((e) => e.operationId)).toEqual(["op-b", "op-c", "op-a"]);
  });

  it("rejects duplicate operation ids", async () => {
    await db.outbox.add(outbox("op-1", 10));
    await expect(db.outbox.add(outbox("op-1", 10))).rejects.toThrow();
  });

  it("rolls back a transaction that fails midway", async () => {
    await expect(
      db.transaction("rw", db.sales, db.outbox, async () => {
        await db.outbox.add(outbox("op-x", 10));
        throw new Error("crash during checkout");
      }),
    ).rejects.toThrow("crash during checkout");
    expect(await db.outbox.count()).toBe(0);
  });
});
