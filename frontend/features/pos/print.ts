import { toast } from "sonner";

import type { PosContext } from "@/lib/db/context";
import { printDocument } from "@/lib/printing/output";
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
