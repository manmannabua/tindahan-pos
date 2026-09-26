/**
 * Find a sale to return. Local first (works offline); if the receipt isn't on this terminal and
 * the server is reachable, look it up across all terminals of the company.
 */
import { ApiError } from "@/lib/api/errors";
import type { DeviceClient } from "@/lib/device/device-client";
import type { LocalSale, PosDatabase } from "@/lib/db/schema";
import type { SaleLookupResponse } from "@/types/sync";

import { remoteSaleFromLookup, type RemoteSale } from "./voids-returns";

export type SaleLookupResult =
  | { kind: "local"; sale: LocalSale }
  | { kind: "remote"; remote: RemoteSale }
  | { kind: "not_found" }
  | { kind: "offline" };

export async function findSaleForReturn(
  db: PosDatabase,
  receiptNumber: string,
  options: { online: boolean; client: Pick<DeviceClient, "request"> },
): Promise<SaleLookupResult> {
  const code = receiptNumber.trim().toUpperCase();
  const local = await db.sales.where("receiptNumber").equals(code).first();
  if (local) return { kind: "local", sale: local };
  if (!options.online) return { kind: "offline" };
  try {
    const found = await options.client.request<SaleLookupResponse>("/sync/sales/lookup", { query: { receipt_number: code } });
    return { kind: "remote", remote: remoteSaleFromLookup(found) };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return { kind: "not_found" };
    return { kind: "offline" };
  }
}
