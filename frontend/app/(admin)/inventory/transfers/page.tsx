"use client";

import { ArrowLeftRightIcon, ArrowRightIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { TextField } from "@/components/shared/form-fields";
import { humanize } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { useCreateTransfer, useLocationLabels, useTransfers } from "@/features/inventory/api";
import { unitIdOrNull } from "@/features/inventory/components/item-picker";
import { type ItemLine, ItemLinesEditor, validateQuantities } from "@/features/inventory/components/item-lines-editor";
import { StockLocationSelect } from "@/features/inventory/components/stock-location-select";
import { TRANSFER_BADGE } from "@/features/inventory/transfer-status";
import { ADMIN_PERM } from "@/features/shell/permissions";
import { errorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 20;

export default function TransfersPage() {
  const router = useRouter();
  const canTransfer = usePermissionInAnyScope(ADMIN_PERM.INVENTORY_TRANSFER);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const labels = useLocationLabels();
  const { data, isPending, error, refetch } = useTransfers({ limit: PAGE_SIZE, offset });

  return (
    <>
      <PageHeader
        title="Stock transfers"
        description="Goods leave the source when sent and arrive when received."
        actions={
          canTransfer && (
            <Button onClick={() => setOpen(true)}>
              <PlusIcon /> New transfer
            </Button>
          )
        }
      />
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={ArrowLeftRightIcon} title="No transfers yet" />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Route</TableHead>
                  <TableHead className="hidden md:table-cell">Created</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((t) => (
                  <TableRow key={t.id} className="h-11 cursor-pointer" onClick={() => router.push(`/inventory/transfers/${t.id}`)}>
                    <TableCell className="font-mono">{t.number}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1">
                        {labels[t.from_location_id] ?? "?"} <ArrowRightIcon className="size-3" /> {labels[t.to_location_id] ?? "?"}
                      </span>
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{formatDateTime(t.created_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.lines.length}</TableCell>
                    <TableCell>
                      <Badge variant={TRANSFER_BADGE[t.status] ?? "outline"}>{humanize(t.status)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </>
      )}
      <CreateTransferDialog open={open} onOpenChange={setOpen} onCreated={(id) => router.push(`/inventory/transfers/${id}`)} />
    </>
  );
}

function CreateTransferDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const create = useCreateTransfer();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    const invalid = !from || !to ? "Choose both locations." : from === to ? "Source and destination must differ." : validateQuantities(lines);
    setProblem(invalid);
    if (invalid) return;
    try {
      const transfer = await create.mutateAsync({
        from_location_id: from,
        to_location_id: to,
        note: note.trim() || null,
        lines: lines.map((l) => ({ variant_id: l.item.variantId, unit_id: unitIdOrNull(l.unit), quantity: l.quantity.trim() })),
      });
      setLines([]);
      onCreated(transfer.id);
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New transfer</DialogTitle>
          <DialogDescription>Saved as a draft. Stock moves when you send it.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>From</Label>
              <StockLocationSelect value={from} onChange={setFrom} aria-label="From location" />
            </div>
            <div className="grid gap-2">
              <Label>To</Label>
              <StockLocationSelect value={to} onChange={setTo} exclude={from} aria-label="To location" />
            </div>
          </div>
          <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <ItemLinesEditor lines={lines} onChange={setLines} />
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={create.isPending}>
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
