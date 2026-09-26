/**
 * Customers on the terminal: local search and offline creation (`customer.upsert`, priority 8,
 * so it reaches the server before any sale that references it).
 */
import { v7 as uuidv7 } from "uuid";

import type { LocalCustomer, PosDatabase } from "@/lib/db/schema";
import { enqueue, PRIORITY } from "@/lib/sync/outbox";
import { searchTokens } from "@/lib/sync/pull-applier";
import type { CustomerUpsertPayload } from "@/types/sync";

/** Same rule as backend customers/service.py `normalize_phone`: keep digits and '+'. */
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.trim().replace(/[^\d+]/g, "");
  return digits || null;
}

export async function searchCustomers(db: PosDatabase, query: string, limit = 20): Promise<LocalCustomer[]> {
  const q = query.trim();
  if (!q) return [];
  const phone = /^[\d\s+()-]+$/.test(q) ? normalizePhone(q) : null;
  let rows: LocalCustomer[];
  if (phone && phone.length >= 3) {
    rows = await db.customers.where("phone").startsWith(phone).limit(limit).toArray();
  } else {
    const words = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.length === 0) return [];
    const [first, ...rest] = [...words].sort((a, b) => b.length - a.length);
    rows = await db.customers
      .where("searchTokens")
      .startsWith(first)
      .distinct()
      .filter((c) => rest.every((w) => c.searchTokens.some((t) => t.startsWith(w))))
      .limit(limit)
      .toArray();
  }
  return rows.filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name));
}

export interface NewCustomer {
  name: string;
  phone?: string | null;
  email?: string | null;
  priceLevelId?: string | null;
}

export async function createCustomerOffline(
  db: PosDatabase,
  args: NewCustomer & { deviceId: string; userId: string; now?: Date },
): Promise<LocalCustomer> {
  const name = args.name.trim();
  if (!name) throw new Error("Customer name is required");
  const customer: LocalCustomer = {
    id: uuidv7(),
    code: null,
    name,
    phone: normalizePhone(args.phone),
    email: args.email?.trim() || null,
    priceLevelId: args.priceLevelId ?? null,
    isActive: true,
    searchTokens: [],
  };
  customer.searchTokens = searchTokens(customer.name, customer.code, customer.phone);
  const payload: CustomerUpsertPayload = {
    id: customer.id,
    user_id: args.userId,
    name: customer.name,
    code: null,
    phone: customer.phone,
    email: customer.email,
    price_level_id: customer.priceLevelId,
    notes: null,
  };
  await db.transaction("rw", db.customers, db.outbox, async () => {
    await db.customers.add(customer);
    await enqueue(db, {
      deviceId: args.deviceId,
      entityType: "customer",
      entityId: customer.id,
      operation: "customer.upsert",
      payload,
      priority: PRIORITY.CUSTOMER,
      now: args.now,
    });
  });
  return customer;
}
