"use client";

import { PrinterIcon, Undo2Icon, XCircleIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLiveQuery } from "@/hooks/use-live-query";
import { getDb, type LocalSale } from "@/lib/db/schema";
import { formatMoney } from "@/lib/money";
import { loadReceipt } from "@/lib/pos/receipts";
import { printReceipt } from "@/lib/printing/print";
import { usePosSession } from "@/stores/pos-session-store";

import { ReturnDialog } from "./return-dialog";
import { VoidDialog } from "./void-dialog";

const SYNC_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  SYNCED: "secondary",
  PENDING: "outline",
  FAILED: "destructive",
  CONFLICT: "destructive",
};

/** Recent sales on this terminal (from IndexedDB): reprint, void (current shift), return. */
export function SalesHistory() {
  const context = usePosSession((s) => s.context);
  const cashSession = usePosSession((s) => s.cashSession);
  const sales = useLiveQuery(() => getDb().sales.orderBy("occurredAt").reverse().limit(100).toArray(), [], []);
  const returnedSaleIds = useLiveQuery(
    async () => new Set((await getDb().returns.toArray()).map((r) => r.saleId)),
    [],
    new Set<string>(),
  );
  const [voiding, setVoiding] = useState<LocalSale | null>(null);
  const [returning, setReturning] = useState<LocalSale | null>(null);
  if (!context) return null;

  const reprint = async (saleId: string) => {
    const doc = await loadReceipt(getDb(), saleId, context, true);
    if (doc) await printReceipt(doc);
  };

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <h1 className="mb-3 text-xl font-semibold">Recent sales</h1>
      <ul className="divide-y rounded-xl border bg-background" aria-label="Recent sales">
        {sales.map((s) => {
          const completed = s.status === "COMPLETED";
          // Voids are for the open shift only (the server enforces the same by time).
          const canVoid =
            completed && !returnedSaleIds.has(s.id) && (s.cashSessionId === null || s.cashSessionId === cashSession?.id);
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="sale-row">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{s.receiptNumber}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(s.occurredAt).toLocaleString()} · {s.cashierName}
                </div>
              </div>
              {!completed && <Badge variant="destructive">VOIDED</Badge>}
              {returnedSaleIds.has(s.id) && <Badge variant="outline">RETURNS</Badge>}
              <Badge variant={SYNC_TONE[s.syncStatus] ?? "outline"}>{s.syncStatus}</Badge>
              <span className="w-28 text-right font-semibold tabular-nums">{formatMoney(s.total, context.company.currency)}</span>
              <div className="flex gap-1">
                <Button size="icon-lg" variant="outline" aria-label={`Reprint ${s.receiptNumber}`} onClick={() => void reprint(s.id)}>
                  <PrinterIcon />
                </Button>
                <Button size="icon-lg" variant="outline" aria-label={`Return items of ${s.receiptNumber}`} disabled={!completed} onClick={() => setReturning(s)}>
                  <Undo2Icon />
                </Button>
                <Button size="icon-lg" variant="outline" aria-label={`Void ${s.receiptNumber}`} disabled={!canVoid} onClick={() => setVoiding(s)}>
                  <XCircleIcon />
                </Button>
              </div>
            </li>
          );
        })}
        {sales.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">No sales yet.</li>}
      </ul>
      <VoidDialog sale={voiding} onClose={() => setVoiding(null)} />
      <ReturnDialog sale={returning} onClose={() => setReturning(null)} />
    </div>
  );
}
