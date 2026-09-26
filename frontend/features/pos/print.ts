import { toast } from "sonner";

import type { PosContext } from "@/lib/db/context";
import { getDb } from "@/lib/db/schema";
import { printFromJournal } from "@/lib/pos/journal";
import { printDocument } from "@/lib/printing/output";
import { triggerSync } from "@/lib/sync/service";
import type { ReceiptDocument } from "@/lib/printing/receipt";

/** Print through the terminal's configured printer; tell the cashier if we had to fall back. */
export async function printWithFeedback(
  doc: ReceiptDocument,
  context: PosContext,
  options: { kickDrawer?: boolean } = {},
): Promise<void> {
  const outcome = await printDocument(doc, context.settings, options);
  if (outcome.fallbackReason) {
    toast.warning(`Receipt printer unavailable (${outcome.fallbackReason}); printed through the browser instead`);
  }
}

/**
 * Print a receipt from the journal (the stored copy) and record the print. A never-printed
 * receipt prints as the original; later prints are marked REPRINT.
 */
export async function printJournalReceipt(
  receiptId: string,
  context: PosContext,
  options: { reprint?: boolean; kickDrawer?: boolean } = {},
): Promise<void> {
  const result = await printFromJournal(getDb(), receiptId, context, options);
  if (!result) {
    toast.error("Receipt not found in the journal");
    return;
  }
  triggerSync(); // report the print now, not at the next scheduled sync
  if (result.fallbackReason) {
    toast.warning(`Receipt printer unavailable (${result.fallbackReason}); printed through the browser instead`);
  }
}
