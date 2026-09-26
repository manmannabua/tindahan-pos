/**
 * Voids and returns on the terminal (Phase 7). Mirror backend/app/modules/returns/service.py:
 *
 * - Void: a whole sale of the still-open shift. Status VOIDED, stock back (SALE_VOID movements,
 *   id = derived(sale_item_id, "SALE_VOID")), outbox `sale.void` (priority 15).
 * - Return: some items of a completed local sale. Refund = the line's paid share
 *   (round(total x qty / sold)); the last units refund exactly what is left, so refunds never
 *   drift from the line total. Over-returns are refused. Restocked items post SALE_RETURN
 *   movements (id = derived(return_item_id, "SALE_RETURN")). Outbox `return.create` (priority 50).
 *
 * Each runs in ONE Dexie transaction with its outbox entry.
 */
import { v7 as uuidv7 } from "uuid";

import { getMeta } from "@/lib/db/meta";
import type {
  LocalPaymentMethod,
  LocalRefund,
  LocalReturn,
  LocalReturnItem,
  LocalSale,
  LocalSaleItem,
  PosDatabase,
} from "@/lib/db/schema";
import { add, compare, multiply, roundMoney, roundQuantity, subtract, toBig, toMoneyString, toQuantityString } from "@/lib/money";
import type { ReceiptDocument } from "@/lib/printing/receipt";
import { enqueue, PRIORITY } from "@/lib/sync/outbox";
import { applyLocalMovement } from "@/lib/sync/reconcile";
import type { ReturnCreatePayload, SaleLookupResponse, SaleVoidPayload } from "@/types/sync";

import { derivedId } from "./ids";
import { addReceipt } from "./journal";

export class ReturnVoidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReturnVoidError";
  }
}

async function tracksInventory(db: PosDatabase, variantId: string): Promise<boolean> {
  const variant = await db.variants.get(variantId);
  const product = variant ? await db.products.get(variant.productId) : undefined;
  return product?.trackInventory ?? true;
}

// --- voids -------------------------------------------------------------------------------------

export interface VoidArgs {
  saleId: string;
  voidedById: string;
  authorizedById: string | null;
  reason: string;
  deviceId: string;
  now?: Date;
}

export async function voidSale(db: PosDatabase, args: VoidArgs): Promise<LocalSale> {
  const reason = args.reason.trim();
  if (reason.length < 3) throw new ReturnVoidError("Enter a reason (at least 3 characters)");
  const now = (args.now ?? new Date()).toISOString();
  return db.transaction(
    "rw",
    [db.meta, db.sales, db.saleItems, db.returns, db.cashSessions, db.variants, db.products, db.inventoryMovements, db.inventory, db.outbox],
    async () => {
      const sale = await db.sales.get(args.saleId);
      if (!sale) throw new ReturnVoidError("Sale not found on this terminal");
      if (sale.status === "VOIDED") throw new ReturnVoidError("Sale is already voided");
      if ((await db.returns.where("saleId").equals(sale.id).count()) > 0) {
        throw new ReturnVoidError("Items of this sale were returned; return the remaining items instead");
      }
      if (sale.cashSessionId) {
        const session = await db.cashSessions.get(sale.cashSessionId);
        if (session?.status !== "OPEN") throw new ReturnVoidError("The shift of this sale is closed; process a return instead");
      }
      const voided: LocalSale = { ...sale, status: "VOIDED", voidedAt: now, voidedById: args.voidedById, voidReason: reason };
      await db.sales.put(voided);
      // The accumulated grand total counts completed sales only (same as the server's reading).
      const grand = (await getMeta(db, "grandTotal")) ?? "0";
      await db.meta.put({ key: "grandTotal", value: toMoneyString(subtract(grand, sale.total)) });

      const items = await db.saleItems.where("saleId").equals(sale.id).toArray();
      for (const item of items) {
        if (!(await tracksInventory(db, item.variantId))) continue;
        await db.inventoryMovements.put({
          id: derivedId(item.id, "SALE_VOID"),
          variantId: item.variantId,
          stockLocationId: sale.stockLocationId,
          signedQuantity: item.baseQuantity,
          movementType: "SALE_VOID",
          referenceId: sale.id,
          occurredAt: now,
          ackedAt: null,
        });
        await applyLocalMovement(db, sale.stockLocationId, item.variantId, item.baseQuantity, now);
      }
      const payload: SaleVoidPayload = {
        id: sale.id,
        voided_by_id: args.voidedById,
        authorized_by_id: args.authorizedById,
        reason,
        occurred_at: now,
      };
      await enqueue(db, {
        deviceId: args.deviceId,
        entityType: "sale",
        entityId: sale.id,
        operation: "sale.void",
        payload,
        priority: PRIORITY.VOID,
        now: args.now,
      });
      return voided;
    },
  );
}

// --- returns -----------------------------------------------------------------------------------

export interface ReturnLineInput {
  saleItemId: string;
  quantity: string;
  restock: boolean;
}

export interface RefundInput {
  method: LocalPaymentMethod;
  amount: string;
  referenceNo?: string | null;
}

export interface ReturnArgs {
  saleId: string;
  /** A sale made on another terminal, found with the online lookup (restocks at `restockLocationId`). */
  remote?: RemoteSale | null;
  restockLocationId?: string;
  lines: ReturnLineInput[];
  refunds: RefundInput[];
  cashier: { id: string; name: string };
  authorizedById: string | null;
  reason: string;
  cashSessionId: string | null;
  deviceId: string;
  receiptPrefix: string;
  now?: Date;
  /** Lay out the return slip; when given, it is stored in the journal in the same transaction. */
  buildReceipt?: (ret: LocalReturn, items: LocalReturnItem[], refunds: LocalRefund[]) => ReceiptDocument;
}

/** The parts of a sold line a return needs (local sale item or a looked-up remote one). */
export type ReturnSaleItem = Pick<
  LocalSaleItem,
  "id" | "lineNo" | "variantId" | "productName" | "unitCode" | "unitFactor" | "quantity" | "total"
>;

export interface ReturnableLine {
  item: ReturnSaleItem;
  returnedQuantity: string;
  remainingQuantity: string;
  returnedRefund: string;
}

/** What is still returnable per line of a sale (from local returns). */
export async function returnableLines(db: PosDatabase, saleId: string): Promise<ReturnableLine[]> {
  const items = (await db.saleItems.where("saleId").equals(saleId).toArray()).sort((a, b) => a.lineNo - b.lineNo);
  const done = await db.returnItems.where("saleItemId").anyOf(items.map((i) => i.id)).toArray();
  return items.map((item) => {
    const mine = done.filter((d) => d.saleItemId === item.id);
    const returnedQuantity = toQuantityString(add(...mine.map((d) => d.quantity)));
    return {
      item,
      returnedQuantity,
      remainingQuantity: toQuantityString(subtract(item.quantity, returnedQuantity)),
      returnedRefund: toMoneyString(add(...mine.map((d) => d.refundAmount))),
    };
  });
}

/** A sale from another terminal (GET /sync/sales/lookup), returnable while online. */
export interface RemoteSale {
  saleId: string;
  receiptNumber: string;
  status: "COMPLETED" | "VOIDED";
  items: ReturnSaleItem[];
  /** Quantity already returned per sale item according to the server. */
  serverReturned: Record<string, string>;
  /** Amount already refunded per sale item according to the server (if reported). */
  serverRefunded?: Record<string, string>;
}

export function remoteSaleFromLookup(lookup: SaleLookupResponse): RemoteSale {
  return {
    saleId: lookup.sale.id,
    receiptNumber: lookup.sale.receipt_number,
    status: lookup.sale.status,
    items: lookup.sale.items.map((i) => ({
      id: i.id,
      lineNo: i.line_no,
      variantId: i.variant_id,
      productName: i.variant_name ? `${i.product_name} ${i.variant_name}` : i.product_name,
      unitCode: i.unit_code,
      unitFactor: toQuantityString(toBig(i.base_quantity).div(toBig(i.quantity))),
      quantity: toQuantityString(i.quantity),
      total: toMoneyString(i.total),
    })),
    serverReturned: lookup.returned_quantities,
    serverRefunded: lookup.refunded_amounts,
  };
}

/**
 * Returnable lines of a remote sale: server-side returns + this terminal's returns of it that
 * haven't synced yet. Earlier refunds are estimated pro-rata (the lookup reports quantities, not
 * amounts); the server re-checks the final "exact remainder" refund.
 */
export async function remoteReturnableLines(db: PosDatabase, remote: RemoteSale): Promise<ReturnableLine[]> {
  const pendingReturns = (await db.returns.where("saleId").equals(remote.saleId).toArray()).filter(
    (r) => r.syncStatus === "PENDING",
  );
  const pendingItems = pendingReturns.length
    ? await db.returnItems.where("returnId").anyOf(pendingReturns.map((r) => r.id)).toArray()
    : [];
  return [...remote.items]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((item) => {
      const local = pendingItems.filter((d) => d.saleItemId === item.id);
      const returnedQuantity = toQuantityString(
        add(remote.serverReturned[item.id] ?? "0", ...local.map((d) => d.quantity)),
      );
      // Exact amounts from the server; pro-rata estimate only for servers that don't report them.
      const reported = remote.serverRefunded?.[item.id];
      const serverRefund =
        reported !== undefined
          ? toBig(reported)
          : roundMoney(
              toBig(item.total).times(toBig(remote.serverReturned[item.id] ?? "0")).div(toBig(item.quantity)),
            );
      return {
        item,
        returnedQuantity,
        remainingQuantity: toQuantityString(subtract(item.quantity, returnedQuantity)),
        returnedRefund: toMoneyString(add(serverRefund, ...local.map((d) => d.refundAmount))),
      };
    });
}

/** Refund for each requested line — the backend's rule, including same-request accumulation. */
export function computeRefunds(lines: ReturnableLine[], requested: ReturnLineInput[]): string[] {
  const byId = new Map(lines.map((l) => [l.item.id, l]));
  const requestedSoFar = new Map<string, string>();
  const refundSoFar = new Map<string, string>();
  return requested.map((r) => {
    const line = byId.get(r.saleItemId);
    if (!line) throw new ReturnVoidError("Item is not part of this sale");
    if (compare(r.quantity, "0") <= 0) throw new ReturnVoidError("Return quantity must be positive");
    const prior = requestedSoFar.get(r.saleItemId) ?? "0";
    const remaining = subtract(line.remainingQuantity, prior);
    if (compare(r.quantity, remaining) > 0) {
      throw new ReturnVoidError(`Only ${toQuantityString(remaining)} of ${line.item.productName} can still be returned`);
    }
    const alreadyThisRequest = refundSoFar.get(r.saleItemId) ?? "0";
    const refund = compare(r.quantity, remaining) === 0
      ? toMoneyString(subtract(subtract(line.item.total, line.returnedRefund), alreadyThisRequest))
      : toMoneyString(roundMoney(toBig(line.item.total).times(toBig(r.quantity)).div(toBig(line.item.quantity))));
    requestedSoFar.set(r.saleItemId, toQuantityString(add(prior, r.quantity)));
    refundSoFar.set(r.saleItemId, toMoneyString(add(alreadyThisRequest, refund)));
    return refund;
  });
}

export function formatReturnNumber(prefix: string, seq: number): string {
  return `${prefix}R${String(seq).padStart(6, "0")}`;
}

export interface CreatedReturn {
  ret: LocalReturn;
  items: LocalReturnItem[];
  refunds: LocalRefund[];
  payload: ReturnCreatePayload;
  /** Journal entry of the return slip (null when no `buildReceipt` was given). */
  receiptId: string | null;
}

export async function createReturn(db: PosDatabase, args: ReturnArgs): Promise<CreatedReturn> {
  const reason = args.reason.trim();
  if (reason.length < 3) throw new ReturnVoidError("Enter a reason (at least 3 characters)");
  const requested = args.lines.filter((l) => compare(l.quantity, "0") > 0);
  if (requested.length === 0) throw new ReturnVoidError("Choose at least one item to return");
  for (const r of args.refunds) {
    if (r.method.requiresReference && !r.referenceNo?.trim()) throw new ReturnVoidError(`${r.method.name} needs a reference number`);
    if (compare(r.amount, "0") <= 0) throw new ReturnVoidError("Refund amounts must be positive");
  }
  const now = (args.now ?? new Date()).toISOString();

  return db.transaction(
    "rw",
    [db.meta, db.sales, db.saleItems, db.returns, db.returnItems, db.refunds, db.variants, db.products, db.inventoryMovements, db.inventory, db.outbox, db.receipts],
    async () => {
      const localSale = args.remote ? undefined : await db.sales.get(args.saleId);
      const saleId = args.remote?.saleId ?? localSale?.id;
      const status = args.remote?.status ?? localSale?.status;
      const restockLocationId = localSale?.stockLocationId ?? args.restockLocationId;
      if (!saleId || !restockLocationId) throw new ReturnVoidError("Sale not found on this terminal");
      if (status !== "COMPLETED") throw new ReturnVoidError("Only completed sales can be returned");
      const lines = args.remote ? await remoteReturnableLines(db, args.remote) : await returnableLines(db, saleId);
      const refundAmounts = computeRefunds(lines, requested);
      const refundTotal = toMoneyString(add(...refundAmounts));
      const paidBack = toMoneyString(add(...args.refunds.map((r) => r.amount)));
      if (paidBack !== refundTotal) {
        throw new ReturnVoidError(`Refund payments (${paidBack}) must equal the refund total (${refundTotal})`);
      }

      const seq = ((await getMeta(db, "returnSeq")) ?? 0) + 1;
      const returnId = uuidv7();
      const ret: LocalReturn = {
        id: returnId,
        saleId,
        returnNumber: formatReturnNumber(args.receiptPrefix, seq),
        cashSessionId: args.cashSessionId,
        cashierId: args.cashier.id,
        cashierName: args.cashier.name,
        authorizedById: args.authorizedById,
        reason,
        refundTotal,
        occurredAt: now,
        syncStatus: "PENDING",
      };
      const byId = new Map(lines.map((l) => [l.item.id, l.item]));
      const items: LocalReturnItem[] = requested.map((r, i) => {
        const saleItem = byId.get(r.saleItemId) as ReturnSaleItem;
        return {
          id: uuidv7(),
          returnId,
          saleItemId: saleItem.id,
          variantId: saleItem.variantId,
          productName: saleItem.productName,
          unitCode: saleItem.unitCode,
          quantity: toQuantityString(r.quantity),
          baseQuantity: toQuantityString(roundQuantity(multiply(r.quantity, saleItem.unitFactor))),
          refundAmount: refundAmounts[i],
          restock: r.restock,
        };
      });
      const refunds: LocalRefund[] = args.refunds.map((r) => ({
        id: uuidv7(),
        returnId,
        paymentMethodId: r.method.id,
        methodName: r.method.name,
        methodKind: r.method.kind,
        amount: toMoneyString(r.amount),
        referenceNo: r.referenceNo?.trim() || null,
      }));

      await db.returns.add(ret);
      await db.returnItems.bulkAdd(items);
      await db.refunds.bulkAdd(refunds);
      for (const item of items) {
        if (!item.restock || !(await tracksInventory(db, item.variantId))) continue;
        await db.inventoryMovements.put({
          id: derivedId(item.id, "SALE_RETURN"),
          variantId: item.variantId,
          stockLocationId: restockLocationId,
          signedQuantity: item.baseQuantity,
          movementType: "SALE_RETURN",
          referenceId: returnId,
          occurredAt: now,
          ackedAt: null,
        });
        await applyLocalMovement(db, restockLocationId, item.variantId, item.baseQuantity, now);
      }

      const payload: ReturnCreatePayload = {
        id: returnId,
        sale_id: saleId,
        return_number: ret.returnNumber,
        cash_session_id: ret.cashSessionId,
        cashier_id: ret.cashierId,
        authorized_by_id: ret.authorizedById,
        reason,
        occurred_at: now,
        items: items.map((i) => ({ id: i.id, sale_item_id: i.saleItemId, quantity: i.quantity, restock: i.restock })),
        refunds: refunds.map((r) => ({ id: r.id, payment_method_id: r.paymentMethodId, amount: r.amount, reference_no: r.referenceNo })),
      };
      await enqueue(db, {
        deviceId: args.deviceId,
        entityType: "return",
        entityId: returnId,
        operation: "return.create",
        payload,
        priority: PRIORITY.RETURN,
        now: args.now,
      });
      const receipt = args.buildReceipt
        ? await addReceipt(
            db,
            {
              kind: "RETURN",
              number: ret.returnNumber,
              saleId: ret.saleId,
              returnId: ret.id,
              issuedAt: ret.occurredAt,
              total: ret.refundTotal,
              cashierName: ret.cashierName,
              doc: args.buildReceipt(ret, items, refunds),
            },
            args.deviceId,
            args.now,
          )
        : null;
      await db.meta.put({ key: "returnSeq", value: seq });
      return { ret, items, refunds, payload, receiptId: receipt?.id ?? null };
    },
  );
}
