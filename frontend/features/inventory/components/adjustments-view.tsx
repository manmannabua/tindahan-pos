"use client";

import { ClipboardEditIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { TextField } from "@/components/shared/form-fields";
import { humanize, qty } from "@/components/shared/formatters";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";

import { useAdjustments, useCreateAdjustment, useLocationLabels } from "../api";
import { unitIdOrNull } from "./item-picker";
import { type ItemLine, ItemLinesEditor, validateQuantities } from "./item-lines-editor";
import { StockLocationSelect } from "./stock-location-select";

const REASONS = [
  { value: "ADJUSTMENT_OUT", label: "Remove (correction)" },
  { value: "ADJUSTMENT_IN", label: "Add (found stock)" },
  { value: "DAMAGED", label: "Damaged" },
  { value: "EXPIRED", label: "Expired" },
];

const PAGE_SIZE = 25;

export function AdjustmentsView({ canAdjust }: { canAdjust: boolean }) {
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const labels = useLocationLabels();
  const { data, isPending, error, refetch } = useAdjustments({ limit: PAGE_SIZE, offset });

  return (
    <div className="space-y-4">
      {canAdjust && (
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}>
            <PlusIcon /> New adjustment
          </Button>
        </div>
      )}
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={ClipboardEditIcon} title="No adjustments" description="Record breakage, expiry or found stock here." />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="hidden md:table-cell">Location</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="hidden lg:table-cell">Lines</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((a) => (
                  <TableRow key={a.id} className="h-11">
                    <TableCell className="font-mono">{a.number}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDateTime(a.created_at)}</TableCell>
                    <TableCell className="hidden md:table-cell">{labels[a.stock_location_id] ?? "—"}</TableCell>
                    <TableCell>{a.reason}</TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                      {a.lines.map((l) => `${humanize(l.movement_type)} ${qty(l.base_quantity)}`).join(", ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </>
      )}
      <AdjustmentDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

function AdjustmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateAdjustment();
  const [locationId, setLocationId] = useState("");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    const invalid = !locationId ? "Choose a location." : reason.trim().length < 3 ? "Describe the reason (3+ characters)." : validateQuantities(lines);
    setProblem(invalid);
    if (invalid) return;
    try {
      const adjustment = await create.mutateAsync({
        stock_location_id: locationId,
        reason: reason.trim(),
        lines: lines.map((l) => ({
          variant_id: l.item.variantId,
          unit_id: unitIdOrNull(l.unit),
          quantity: l.quantity.trim(),
          reason: l.extra.reason as "ADJUSTMENT_IN" | "ADJUSTMENT_OUT" | "DAMAGED" | "EXPIRED",
        })),
      });
      toast.success(`Adjustment ${adjustment.number} posted`);
      setLines([]);
      setReason("");
      onOpenChange(false);
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>New stock adjustment</DialogTitle>
          <DialogDescription>Posted immediately to the inventory ledger. Scan barcodes or search items.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label>Location</Label>
              <StockLocationSelect value={locationId} onChange={setLocationId} />
            </div>
            <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Water damage in storage" />
          </div>
          <ItemLinesEditor lines={lines} onChange={setLines} extra={[{ key: "reason", label: "Type", options: REASONS, width: "w-44" }]} />
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={create.isPending}>
            Post adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
