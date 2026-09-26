"use client";

import { AlertTriangleIcon, PrinterIcon, ReceiptTextIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { VirtualReceipt } from "@/components/shared/virtual-receipt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLiveQuery } from "@/hooks/use-live-query";
import { getDb, type LocalReceipt } from "@/lib/db/schema";
import { formatMoney } from "@/lib/money";
import { ensureJournal, journalDocument } from "@/lib/pos/journal";
import { cn } from "@/lib/utils";
import { usePosSession } from "@/stores/pos-session-store";

import { printJournalReceipt } from "../print";

type Filter = "all" | "unprinted" | "returns";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unprinted", label: "Not printed" },
  { id: "returns", label: "Returns" },
];

export function PrintStateBadge({ receipt }: { receipt: Pick<LocalReceipt, "printState" | "printCount"> }) {
  if (receipt.printState === "NOT_PRINTED") {
    return (
      <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300">
        Not printed
      </Badge>
    );
  }
  const times = receipt.printCount > 1 ? ` ×${receipt.printCount}` : "";
  return receipt.printState === "PRINTED" ? (
    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
      Printed{times}
    </Badge>
  ) : (
    <Badge variant="secondary" title="Sent to the browser print dialog (can't confirm it printed)">
      Browser print{times}
    </Badge>
  );
}

/**
 * Every receipt this terminal issued — printed or not — kept in the local journal (and synced).
 * Shown exactly as issued; printing uses the stored copy.
 */
export function ReceiptsJournal() {
  const context = usePosSession((s) => s.context);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const receipts = useLiveQuery(() => getDb().receipts.orderBy("issuedAt").reverse().limit(500).toArray(), [], []);

  // Sales from before the journal existed get (reconstructed) entries the first time.
  useEffect(() => {
    if (context) void ensureJournal(getDb(), context);
  }, [context]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return receipts.filter(
      (r) =>
        (!q || r.number.toLowerCase().includes(q)) &&
        (filter !== "unprinted" || r.printState === "NOT_PRINTED") &&
        (filter !== "returns" || r.kind === "RETURN"),
    );
  }, [receipts, query, filter]);
  if (!context) return null;
  const selected = shown.find((r) => r.id === selectedId) ?? shown[0] ?? null;

  const print = async (receipt: LocalReceipt) => {
    setPrinting(true);
    try {
      await printJournalReceipt(receipt.id, context);
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto]">
      <section aria-label="Receipt journal" className="min-w-0">
        <h1 className="mb-1 text-xl font-semibold">Receipts</h1>
        <p className="text-muted-foreground mb-3 text-sm">Every receipt issued on this terminal, printed or not.</p>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
            <Input
              aria-label="Search receipt number"
              placeholder="Receipt or return number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 pl-8"
            />
          </div>
          <div className="flex gap-1" role="radiogroup" aria-label="Show">
            {FILTERS.map((f) => (
              <Button
                key={f.id}
                role="radio"
                aria-checked={filter === f.id}
                variant={filter === f.id ? "secondary" : "ghost"}
                className="h-11"
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>
        <ul className="bg-background divide-y rounded-xl border" aria-label="Receipts">
          {shown.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                aria-current={selected?.id === r.id}
                onClick={() => setSelectedId(r.id)}
                className={cn(
                  "hover:bg-muted/60 flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left",
                  selected?.id === r.id && "bg-muted",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {r.number}
                    {r.kind === "RETURN" && (
                      <Badge variant="outline" className="ml-2">
                        Return
                      </Badge>
                    )}
                  </span>
                  <span className="text-muted-foreground block text-xs">
                    {new Date(r.issuedAt).toLocaleString()} · {r.cashierName}
                  </span>
                </span>
                <PrintStateBadge receipt={r} />
                {r.syncStatus !== "SYNCED" && <Badge variant="outline">Not synced</Badge>}
                <span className="w-24 text-right font-semibold tabular-nums">
                  {r.kind === "RETURN" ? "-" : ""}
                  {formatMoney(r.total, context.company.currency)}
                </span>
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="text-muted-foreground px-4 py-10 text-center text-sm">
              {receipts.length === 0 ? "No receipts yet." : "No receipts match."}
            </li>
          )}
        </ul>
      </section>

      {selected && (
        <aside aria-label={`Receipt ${selected.number}`} className="lg:sticky lg:top-4 lg:self-start">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ReceiptTextIcon className="text-muted-foreground size-4" aria-hidden />
              <span className="font-medium">{selected.number}</span>
              <PrintStateBadge receipt={selected} />
            </div>
            <Button className="h-11" disabled={printing} onClick={() => void print(selected)}>
              <PrinterIcon /> {selected.printCount === 0 ? "Print" : "Reprint"}
            </Button>
          </div>
          {selected.lastPrintError && (
            <p className="mb-2 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangleIcon className="size-3.5" /> Last print used the browser: {selected.lastPrintError}
            </p>
          )}
          {selected.reconstructed && (
            <p className="text-muted-foreground mb-2 text-xs">Rebuilt from the stored sale (issued before the journal existed).</p>
          )}
          <div className="max-h-[75svh] overflow-y-auto rounded-lg bg-muted/40 p-3">
            <VirtualReceipt doc={journalDocument(selected)} label={`Receipt ${selected.number}`} />
          </div>
        </aside>
      )}
    </div>
  );
}
