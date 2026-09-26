"use client";

import { ClipboardCheckIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { humanize } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TextField } from "@/components/shared/form-fields";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { useCounts, useLocationLabels, useStartCount } from "@/features/inventory/api";
import { StockLocationSelect } from "@/features/inventory/components/stock-location-select";
import { ADMIN_PERM } from "@/features/shell/permissions";
import { errorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 20;

export default function StockCountsPage() {
  const router = useRouter();
  const canCount = usePermissionInAnyScope(ADMIN_PERM.INVENTORY_COUNT);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const labels = useLocationLabels();
  const { data, isPending, error, refetch } = useCounts({ limit: PAGE_SIZE, offset });

  return (
    <>
      <PageHeader
        title="Stock counts"
        description="Count shelves by scanning; variances post as STOCK_COUNT movements when completed."
        actions={
          canCount && (
            <Button onClick={() => setOpen(true)}>
              <PlusIcon /> Start count
            </Button>
          )
        }
      />
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={ClipboardCheckIcon} title="No stock counts yet" />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="hidden md:table-cell">Started</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="w-32">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((c) => (
                  <TableRow key={c.id} className="h-11 cursor-pointer" onClick={() => router.push(`/inventory/counts/${c.id}`)}>
                    <TableCell className="font-mono">
                      {c.number} {c.is_full && <Badge variant="outline">Full</Badge>}
                    </TableCell>
                    <TableCell>{labels[c.stock_location_id] ?? "—"}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{formatDateTime(c.started_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">{c.lines.length}</TableCell>
                    <TableCell>
                      <Badge variant={c.status === "IN_PROGRESS" ? "default" : "secondary"}>{humanize(c.status)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </>
      )}
      <StartCountDialog open={open} onOpenChange={setOpen} onStarted={(id) => router.push(`/inventory/counts/${id}`)} />
    </>
  );
}

function StartCountDialog({ open, onOpenChange, onStarted }: { open: boolean; onOpenChange: (v: boolean) => void; onStarted: (id: string) => void }) {
  const start = useStartCount();
  const [locationId, setLocationId] = useState("");
  const [full, setFull] = useState(false);
  const [note, setNote] = useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a stock count</DialogTitle>
          <DialogDescription>
            A full count sets every item you don&apos;t count to zero. A partial count only adjusts the items you count.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Location</Label>
            <StockLocationSelect value={locationId} onChange={setLocationId} />
          </div>
          <div className="flex items-center gap-2">
            <Switch id="full-count" checked={full} onCheckedChange={setFull} />
            <Label htmlFor="full-count">Full count (whole location)</Label>
          </div>
          <TextField label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!locationId || start.isPending}
            onClick={() =>
              start.mutate(
                { stock_location_id: locationId, is_full: full, note: note.trim() || null },
                { onSuccess: (c) => onStarted(c.id), onError: (e) => toast.error(errorMessage(e)) },
              )
            }
          >
            Start
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
