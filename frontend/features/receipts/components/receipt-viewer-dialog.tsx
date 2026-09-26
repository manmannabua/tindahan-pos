"use client";

import { PrinterIcon } from "lucide-react";

import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { VirtualReceipt } from "@/components/shared/virtual-receipt";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { printReceipt } from "@/lib/printing/print";
import type { ReceiptDocument, ReceiptLine } from "@/lib/printing/receipt";
import type { SalesReceipt } from "@/types/api-admin";

import { useReceipt } from "../api";

export function PrintedBadge({ count }: { count: number }) {
  return count === 0 ? (
    <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300">
      Not printed
    </Badge>
  ) : (
    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
      Printed{count > 1 ? ` ×${count}` : ""}
    </Badge>
  );
}

/** The stored receipt as a document (lines were validated by the server when synced). */
export function receiptDocument(receipt: Pick<SalesReceipt, "width" | "lines">): ReceiptDocument {
  return { width: receipt.width === 58 ? 58 : 80, lines: receipt.lines as unknown as ReceiptLine[] };
}

/** A back-office copy: marked COPY after the header so it can't pass as the original. */
function copyDocument(receipt: Pick<SalesReceipt, "width" | "lines">): ReceiptDocument {
  const doc = receiptDocument(receipt);
  const lines = [...doc.lines];
  const firstRule = lines.findIndex((l) => l.kind === "rule");
  lines.splice(firstRule < 0 ? 0 : firstRule, 0, { kind: "center", text: "*** COPY ***", bold: true });
  return { ...doc, lines };
}

/** The virtual receipt exactly as issued, with its print history. */
export function ReceiptViewerDialog({ receiptId, onClose }: { receiptId: string | null; onClose: () => void }) {
  const { data, isPending, error, refetch } = useReceipt(receiptId);
  return (
    <Dialog open={receiptId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {data ? `${data.kind === "RETURN" ? "Return" : "Receipt"} ${data.number}` : "Receipt"}
            {data && <PrintedBadge count={data.print_count} />}
          </DialogTitle>
          <DialogDescription>
            {data ? `${formatDateTime(data.issued_at)} · terminal ${data.terminal_code} · ${data.cashier_name}` : "Loading…"}
          </DialogDescription>
        </DialogHeader>
        {isPending ? (
          <TableSkeleton rows={6} />
        ) : error ? (
          <QueryError error={error} onRetry={() => void refetch()} />
        ) : (
          <div className="grid gap-4">
            {data.reconstructed && (
              <p className="text-muted-foreground text-xs">Rebuilt from the stored sale (issued before the receipt journal existed).</p>
            )}
            <div className="rounded-lg bg-muted/50 p-3">
              <VirtualReceipt doc={receiptDocument(data)} label={`Receipt ${data.number}`} />
            </div>
            <div>
              <h3 className="mb-1 text-sm font-medium">Print history</h3>
              {data.prints.length === 0 ? (
                <p className="text-muted-foreground text-sm">Never printed — this receipt exists only as a virtual copy.</p>
              ) : (
                <ul className="text-muted-foreground space-y-1 text-sm">
                  {data.prints.map((p) => (
                    <li key={p.id}>
                      {formatDateTime(p.printed_at)} · {p.method === "ESCPOS" ? "thermal printer" : "browser print"} ·{" "}
                      {p.is_reprint ? "reprint" : "original"} · {p.terminal_code}
                      {p.fallback_reason && <span className="block pl-4 text-xs">printer unavailable: {p.fallback_reason}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end">
              {/* A copy printed from the back office; the journal records terminal prints only. */}
              <Button variant="outline" onClick={() => void printReceipt(copyDocument(data))}>
                <PrinterIcon /> Print copy
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
