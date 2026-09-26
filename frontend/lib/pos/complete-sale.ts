/**
 * Complete a sale — entirely local. See docs/OFFLINE_ARCHITECTURE.md §3.
 *
 * ONE Dexie transaction writes: sales, saleItems, payments, provisional inventory movements,
 * the inventory snapshot, the `sale.complete` outbox operation and the receipt sequence. If the
 * browser dies halfway, IndexedDB rolls everything back; the cart checkpoint still exists.
 */
import { v5 as uuidv5, v7 as uuidv7 } from "uuid";

import { getMeta } from "@/lib/db/meta";
import type {
  LocalDiscount,
  LocalPayment,
  LocalPaymentMethod,
  LocalSale,
  LocalSaleItem,
  PosDatabase,
} from "@/lib/db/schema";
import { multiply, roundQuantity, subtract, toMoneyString, toQuantityString } from "@/lib/money";
import { settlePayments } from "@/lib/money/sale-calculation";
import { applyLocalMovement } from "@/lib/sync/reconcile";
import { enqueue, PRIORITY } from "@/lib/sync/outbox";
import type { DiscountPayload, SaleCompletePayload } from "@/types/sync";

import { calculateCart, effectiveDiscount, unitPrice, type Cart } from "./cart";

/** Same namespace as backend app/shared/ids.py: `derived_id(source, purpose)`. */
export const POS_NAMESPACE = "6f1c8a52-3d4e-4b7a-9c1e-2a5b8d0f4e11";

export function derivedId(source: string, purpose: string): string {
  return uuidv5(`${source}:${purpose}`, POS_NAMESPACE);
}

export interface TenderInput {
  method: LocalPaymentMethod;
  /** Applied to the sale. */
  amount: string;
  /** Cash handed over (cash only). */
  tendered?: string | null;
  referenceNo?: string | null;
}

export interface CompleteSaleArgs {
  cart: Cart;
  tenders: TenderInput[];
  cashier: { id: string; name: string };
  cashSessionId: string | null;
  priceLevelId: string;
  pricesIncludeTax: boolean;
  deviceId: string;
  receiptPrefix: string;
  stockLocationId: string;
  notes?: string | null;
  now?: Date;
}

export class SaleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SaleValidationError";
  }
}

export function formatReceiptNumber(prefix: string, seq: number): string {
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

function discountPayload(d: LocalDiscount | null): DiscountPayload | null {
  return d ? { kind: d.kind, value: toMoneyString(d.value), reason: d.reason, authorized_by_id: d.authorizedById } : null;
}

export interface CompletedSale {
  sale: LocalSale;
  items: LocalSaleItem[];
  payments: LocalPayment[];
  payload: SaleCompletePayload;
}

export async function completeSale(db: PosDatabase, args: CompleteSaleArgs): Promise<CompletedSale> {
  const totals = calculateCart(args.cart, args.pricesIncludeTax);
  if (!totals.ok) throw new SaleValidationError(totals.error);
  const calc = totals.calculation;
  for (const t of args.tenders) {
    if (t.method.requiresReference && !t.referenceNo?.trim()) {
      throw new SaleValidationError(`${t.method.name} needs a reference number`);
    }
  }
  let settlement;
  try {
    settlement = settlePayments(
      calc.totals.total,
      args.tenders.map((t) => ({ methodKind: t.method.kind, amount: t.amount, tendered: t.tendered ?? null })),
    );
  } catch (error) {
    throw new SaleValidationError(error instanceof Error ? error.message : String(error));
  }

  const now = (args.now ?? new Date()).toISOString();
  const saleId = uuidv7();

  const items: LocalSaleItem[] = args.cart.lines.map((line, i) => {
    const r = calc.lines[i];
    const price = unitPrice(line) ?? "0";
    return {
      id: line.id,
      saleId,
      lineNo: i + 1,
      variantId: line.item.variantId,
      productUnitId: line.item.productUnitId,
      unitCode: line.item.unitCode,
      unitFactor: line.item.unitFactor,
      productName: line.item.productName,
      variantName: line.item.variantName,
      sku: line.item.sku,
      barcode: line.item.barcode,
      quantity: toQuantityString(line.quantity),
      baseQuantity: toQuantityString(roundQuantity(multiply(line.quantity, line.item.unitFactor))),
      unitPrice: toMoneyString(price),
      originalUnitPrice: line.override && line.listPrice ? toMoneyString(line.listPrice) : null,
      priceOverriddenById: line.override?.authorizedById ?? null,
      discount: effectiveDiscount(line),
      promotionId: line.discount ? null : (line.promotion?.id ?? null),
      taxRateId: line.item.taxRateId,
      taxRate: line.item.taxRate,
      taxKind: line.item.taxKind,
      gross: r.gross,
      lineDiscount: r.lineDiscount,
      orderDiscountShare: r.orderDiscountShare,
      net: r.net,
      taxAmount: r.taxAmount,
      total: r.total,
    };
  });

  const payments: LocalPayment[] = args.tenders.map((t) => {
    const amount = toMoneyString(t.amount);
    const tendered = t.method.kind === "CASH" && t.tendered ? toMoneyString(t.tendered) : null;
    return {
      id: uuidv7(),
      saleId,
      paymentMethodId: t.method.id,
      methodName: t.method.name,
      methodKind: t.method.kind,
      amount,
      tendered,
      change: tendered ? toMoneyString(subtract(tendered, amount)) : "0.00",
      referenceNo: t.referenceNo?.trim() || null,
      occurredAt: now,
    };
  });

  return db.transaction(
    "rw",
    [db.meta, db.sales, db.saleItems, db.payments, db.inventoryMovements, db.inventory, db.outbox, db.activeCart],
    async () => {
      const seq = ((await getMeta(db, "receiptSeq")) ?? 0) + 1;
      const receiptNumber = formatReceiptNumber(args.receiptPrefix, seq);
      const sale: LocalSale = {
        id: saleId,
        receiptNumber,
        cashSessionId: args.cashSessionId,
        cashierId: args.cashier.id,
        cashierName: args.cashier.name,
        customerId: args.cart.customerId,
        priceLevelId: args.priceLevelId,
        stockLocationId: args.stockLocationId,
        status: "COMPLETED",
        pricesIncludeTax: args.pricesIncludeTax,
        orderDiscount: args.cart.orderDiscount,
        ...calc.totals,
        paidTotal: settlement.paidTotal,
        changeTotal: settlement.changeTotal,
        occurredAt: now,
        syncStatus: "PENDING",
      };
      const payload = buildPayload(sale, items, payments, args);

      await db.sales.add(sale);
      await db.saleItems.bulkAdd(items);
      await db.payments.bulkAdd(payments);

      for (const [i, item] of items.entries()) {
        // Services / non-stock items post no movements (same rule as the server ledger).
        if (!args.cart.lines[i].item.trackInventory) continue;
        const signed = `-${item.baseQuantity}`;
        await db.inventoryMovements.add({
          id: derivedId(item.id, "SALE"),
          variantId: item.variantId,
          stockLocationId: args.stockLocationId,
          signedQuantity: signed,
          movementType: "SALE",
          referenceId: saleId,
          occurredAt: now,
          ackedAt: null,
        });
        await applyLocalMovement(db, args.stockLocationId, item.variantId, signed, now);
      }

      await enqueue(db, {
        deviceId: args.deviceId,
        entityType: "sale",
        entityId: saleId,
        operation: "sale.complete",
        payload,
        priority: PRIORITY.SALE,
        now: args.now,
      });
      await db.meta.put({ key: "receiptSeq", value: seq });
      await db.activeCart.delete("current");
      return { sale, items, payments, payload };
    },
  );
}

function buildPayload(
  sale: LocalSale,
  items: LocalSaleItem[],
  payments: LocalPayment[],
  args: CompleteSaleArgs,
): SaleCompletePayload {
  return {
    schema_version: 1,
    id: sale.id,
    receipt_number: sale.receiptNumber,
    cash_session_id: sale.cashSessionId,
    cashier_id: sale.cashierId,
    customer_id: sale.customerId,
    price_level_id: sale.priceLevelId,
    stock_location_id: sale.stockLocationId,
    prices_include_tax: sale.pricesIncludeTax,
    occurred_at: sale.occurredAt,
    order_discount: discountPayload(sale.orderDiscount),
    notes: args.notes ?? null,
    items: items.map((i) => ({
      id: i.id,
      line_no: i.lineNo,
      variant_id: i.variantId,
      product_unit_id: i.productUnitId,
      unit_code: i.unitCode,
      unit_factor: i.unitFactor,
      product_name: i.productName,
      variant_name: i.variantName,
      sku: i.sku,
      barcode: i.barcode,
      quantity: i.quantity,
      unit_price: i.unitPrice,
      original_unit_price: i.originalUnitPrice,
      price_overridden_by_id: i.priceOverriddenById,
      discount: discountPayload(i.discount),
      promotion_id: i.promotionId ?? null,
      tax_rate_id: i.taxRateId,
      tax_rate: i.taxRate,
      tax_kind: i.taxKind,
      gross: i.gross,
      line_discount: i.lineDiscount,
      order_discount_share: i.orderDiscountShare,
      net: i.net,
      tax_amount: i.taxAmount,
      total: i.total,
    })),
    payments: payments.map((p) => ({
      id: p.id,
      payment_method_id: p.paymentMethodId,
      amount: p.amount,
      tendered: p.tendered,
      reference_no: p.referenceNo,
    })),
    totals: {
      gross_total: sale.grossTotal,
      line_discount_total: sale.lineDiscountTotal,
      order_discount_total: sale.orderDiscountTotal,
      discount_total: sale.discountTotal,
      tax_total: sale.taxTotal,
      total: sale.total,
      paid_total: sale.paidTotal,
      change_total: sale.changeTotal,
      vatable_sales: sale.vatableSales,
      vat_amount: sale.vatAmount,
      exempt_sales: sale.exemptSales,
      zero_rated_sales: sale.zeroRatedSales,
    },
  };
}
