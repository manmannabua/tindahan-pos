import type { PosContext } from "@/lib/db/context";
import type { PosDatabase } from "@/lib/db/schema";
import { buildReceipt, type ReceiptDocument } from "@/lib/printing/receipt";

/** Build the receipt of a stored sale (for printing after checkout or reprinting later). */
export async function loadReceipt(
  db: PosDatabase,
  saleId: string,
  context: PosContext,
  isReprint: boolean,
): Promise<ReceiptDocument | null> {
  const sale = await db.sales.get(saleId);
  if (!sale) return null;
  const [items, payments] = await Promise.all([
    db.saleItems.where("saleId").equals(saleId).toArray(),
    db.payments.where("saleId").equals(saleId).toArray(),
  ]);
  return buildReceipt({
    sale,
    items,
    payments,
    company: context.company,
    branch: context.branch,
    terminalCode: context.device.terminalCode,
    deviceBir: context.deviceBir,
    width: context.settings.receiptWidth,
    isReprint,
  });
}
