"use client";

import { PrinterIcon, SearchIcon, Undo2Icon, XCircleIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getDeviceClient } from "@/lib/device";
import { useLiveQuery } from "@/hooks/use-live-query";
import { getDb, type LocalSale } from "@/lib/db/schema";
import { formatMoney } from "@/lib/money";
import { ensureJournal, journalId } from "@/lib/pos/journal";
import { findSaleForReturn } from "@/lib/pos/sale-lookup";
import { useTerminalStore } from "@/stores/terminal-store";

import { usePosSession } from "@/stores/pos-session-store";

import { printJournalReceipt } from "../print";
import { ReturnDialog, type ReturnTarget } from "./return-dialog";
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
  const [returning, setReturning] = useState<ReturnTarget | null>(null);
  const [receiptQuery, setReceiptQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const online = useTerminalStore((s) => s.connectivity) !== "offline";
  if (!context) return null;

  // Reprints come from the receipt journal (the stored copy); older sales get an entry first.
  const reprint = async (saleId: string) => {
    const db = getDb();
    let receipt = await db.receipts.get(journalId(saleId));
    if (!receipt) {
      await ensureJournal(db, context);
      receipt = await db.receipts.get(journalId(saleId));
    }
    if (receipt) await printJournalReceipt(receipt.id, context, { reprint: true });
  };

  const findReceipt = async () => {
    if (!receiptQuery.trim()) return;
    setSearching(true);
    try {
      const found = await findSaleForReturn(getDb(), receiptQuery, { online, client: getDeviceClient() });
      if (found.kind === "local") {
        setReturning({ saleId: found.sale.id, receiptNumber: found.sale.receiptNumber, remote: null });
      } else if (found.kind === "remote") {
        if (found.remote.status !== "COMPLETED") toast.error("That sale was voided; nothing to return");
        else setReturning({ saleId: found.remote.saleId, receiptNumber: found.remote.receiptNumber, remote: found.remote });
      } else if (found.kind === "not_found") {
        toast.error(`No sale with receipt ${receiptQuery.trim()}`);
      } else {
        toast.error("Offline: only sales made on this terminal can be returned until the connection is back");
      }
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl p-4">
      <h1 className="mb-3 text-xl font-semibold">Recent sales</h1>
      <form
        className="mb-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void findReceipt();
        }}
      >
        <Input
          aria-label="Receipt number to return"
          placeholder="Return by receipt no. (any terminal while online)"
          value={receiptQuery}
          onChange={(e) => setReceiptQuery(e.target.value)}
          className="h-11"
        />
        <Button type="submit" variant="outline" className="h-11" disabled={searching}>
          <SearchIcon /> Find
        </Button>
      </form>
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
                <Button size="icon-lg" variant="outline" aria-label={`Return items of ${s.receiptNumber}`} disabled={!completed} onClick={() => setReturning({ saleId: s.id, receiptNumber: s.receiptNumber, remote: null })}>
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
      <ReturnDialog target={returning} onClose={() => setReturning(null)} />
    </div>
  );
}
