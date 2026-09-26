export const MOVEMENT_TYPES = [
  "INITIAL_STOCK",
  "PURCHASE",
  "PURCHASE_RETURN",
  "SALE",
  "SALE_RETURN",
  "SALE_VOID",
  "TRANSFER_OUT",
  "TRANSFER_IN",
  "ADJUSTMENT_IN",
  "ADJUSTMENT_OUT",
  "DAMAGED",
  "EXPIRED",
  "STOCK_COUNT",
] as const;

/** Where a movement's reference points in the admin portal. */
export function referenceHref(type: string | null, id: string | null): string | null {
  if (!type || !id) return null;
  switch (type) {
    case "sale":
      return `/sales/${id}`;
    case "stock_transfer":
      return `/inventory/transfers/${id}`;
    case "stock_count":
      return `/inventory/counts/${id}`;
    case "goods_receipt":
      return `/purchase-orders/receipts/${id}`;
    case "return":
      return `/sales/returns/${id}`;
    default:
      return null;
  }
}
