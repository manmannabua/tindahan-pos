"use client";

import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { humanize, qty } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocationLabels, useTransfer, useTransferAction, useVariantNamesAt } from "@/features/inventory/api";
import { TRANSFER_BADGE } from "@/features/inventory/transfer-status";
import { errorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";
import { toBig } from "@/lib/money";

export default function TransferPage() {
  const { transferId } = useParams<{ transferId: string }>();
  const { data: transfer, isPending, error, refetch } = useTransfer(transferId);
  const labels = useLocationLabels();
  const names = useVariantNamesAt(transfer?.from_location_id);
  const action = useTransferAction(transferId);
  const [received, setReceived] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<"send" | "receive" | "cancel" | null>(null);

  // Reset the editable quantities whenever a new version of the transfer is loaded.
  const [syncedFrom, setSyncedFrom] = useState(transfer);
  if (transfer !== syncedFrom) {
    setSyncedFrom(transfer);
    if (transfer) setReceived(Object.fromEntries(transfer.lines.map((l) => [l.id, qty(l.base_quantity)])));
  }

  if (isPending) return <TableSkeleton />;
  if (error) return <QueryError error={error} onRetry={() => void refetch()} />;

  const receiving = transfer.status === "IN_TRANSIT";
  const run = (kind: "send" | "receive" | "cancel") => {
    let lines: { line_id: string; received_base_quantity: string }[] | undefined;
    if (kind === "receive") {
      const bad = transfer.lines.find((l) => !/^\d+(\.\d{1,3})?$/.test((received[l.id] ?? "").trim()) || toBig(received[l.id]).gt(toBig(l.base_quantity)));
      if (bad) {
        toast.error("Received quantities must be between 0 and what was sent.");
        return;
      }
      lines = transfer.lines
        .filter((l) => !toBig(received[l.id]).eq(toBig(l.base_quantity)))
        .map((l) => ({ line_id: l.id, received_base_quantity: received[l.id].trim() }));
    }
    action.mutate(
      { action: kind, lines },
      {
        onSuccess: () => {
          toast.success(kind === "send" ? "Transfer sent" : kind === "receive" ? "Transfer received" : "Transfer cancelled");
          setConfirm(null);
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <>
      <Link href="/inventory/transfers" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Transfers
      </Link>
      <PageHeader
        title={`Transfer ${transfer.number}`}
        description={`Created ${formatDateTime(transfer.created_at)}${transfer.sent_at ? ` · sent ${formatDateTime(transfer.sent_at)}` : ""}${transfer.received_at ? ` · received ${formatDateTime(transfer.received_at)}` : ""}`}
        actions={
          <>
            <Badge variant={TRANSFER_BADGE[transfer.status] ?? "outline"}>{humanize(transfer.status)}</Badge>
            {(transfer.status === "DRAFT" || receiving) && (
              <Button variant="outline" onClick={() => setConfirm("cancel")}>
                Cancel
              </Button>
            )}
            {transfer.status === "DRAFT" && <Button onClick={() => setConfirm("send")}>Send</Button>}
            {receiving && <Button onClick={() => setConfirm("receive")}>Receive</Button>}
          </>
        }
      />
      <p className="mb-4 flex items-center gap-2 text-sm">
        {labels[transfer.from_location_id]} <ArrowRightIcon className="size-4" /> {labels[transfer.to_location_id]}
        {transfer.note && <span className="text-muted-foreground">· {transfer.note}</span>}
      </p>
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Sent (base units)</TableHead>
              <TableHead className="w-40 text-right">Received</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transfer.lines.map((l) => (
              <TableRow key={l.id} className="h-11">
                <TableCell>{names[l.variant_id] ?? l.variant_id.slice(0, 8)}</TableCell>
                <TableCell className="text-right tabular-nums">{qty(l.base_quantity)}</TableCell>
                <TableCell className="text-right">
                  {receiving ? (
                    <Input
                      aria-label={`Received for ${names[l.variant_id] ?? "item"}`}
                      className="ml-auto h-8 w-28 text-right"
                      inputMode="decimal"
                      value={received[l.id] ?? ""}
                      onChange={(e) => setReceived({ ...received, [l.id]: e.target.value })}
                    />
                  ) : (
                    <span className="tabular-nums">{qty(l.received_base_quantity)}</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm === "send" ? "Send this transfer?" : confirm === "receive" ? "Receive this transfer?" : "Cancel this transfer?"}
        description={
          confirm === "send"
            ? "Stock leaves the source location now."
            : confirm === "receive"
              ? "Received quantities are added to the destination. Shortages are flagged for review."
              : receiving
                ? "The goods return to the source location."
                : "The draft is discarded."
        }
        confirmLabel={confirm === "send" ? "Send" : confirm === "receive" ? "Receive" : "Cancel transfer"}
        destructive={confirm === "cancel"}
        pending={action.isPending}
        onConfirm={() => confirm && run(confirm)}
      />
    </>
  );
}
