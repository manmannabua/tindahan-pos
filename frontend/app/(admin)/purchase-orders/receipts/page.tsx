"use client";

import { ArrowLeftIcon, PackageCheckIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { TextField } from "@/components/shared/form-fields";
import { money } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { useLocationLabels } from "@/features/inventory/api";
import { unitIdOrNull } from "@/features/inventory/components/item-picker";
import { type ItemLine, ItemLinesEditor, validateQuantities } from "@/features/inventory/components/item-lines-editor";
import { StockLocationSelect } from "@/features/inventory/components/stock-location-select";
import { useReceipts, useReceiveGoods, useSupplierLabels } from "@/features/purchasing/api";
import { SupplierSelect } from "@/features/purchasing/components/supplier-select";
import { ADMIN_PERM } from "@/features/shell/permissions";
import { errorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 25;
const COST = /^\d+(\.\d{1,4})?$/;

export default function GoodsReceiptsPage() {
  const router = useRouter();
  const canReceive = usePermissionInAnyScope(ADMIN_PERM.PURCHASING_RECEIVE);
  const [offset, setOffset] = useState(0);
  const [supplierId, setSupplierId] = useState("");
  const [open, setOpen] = useState(false);
  const suppliers = useSupplierLabels();
  const locations = useLocationLabels();
  const { data, isPending, error, refetch } = useReceipts({ supplier_id: supplierId || undefined, limit: PAGE_SIZE, offset });

  return (
    <>
      <Link href="/purchase-orders" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Purchase orders
      </Link>
      <PageHeader
        title="Goods receipts"
        description="Every receipt posts PURCHASE movements and updates average costs."
        actions={
          canReceive && (
            <Button onClick={() => setOpen(true)}>
              <PlusIcon /> Direct receipt
            </Button>
          )
        }
      />
      <div className="mb-4 w-full sm:w-64">
        <SupplierSelect allowAll value={supplierId} onChange={(v) => { setSupplierId(v); setOffset(0); }} />
      </div>
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={PackageCheckIcon} title="No goods receipts" />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="hidden md:table-cell">Location</TableHead>
                  <TableHead className="hidden md:table-cell">Invoice</TableHead>
                  <TableHead className="hidden sm:table-cell">Received</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow key={r.id} className="h-11 cursor-pointer" onClick={() => router.push(`/purchase-orders/receipts/${r.id}`)}>
                    <TableCell className="font-mono">{r.number}</TableCell>
                    <TableCell>{suppliers[r.supplier_id] ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{locations[r.stock_location_id] ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{r.supplier_invoice_no ?? "—"}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDateTime(r.received_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(r.total_cost)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </>
      )}
      <DirectReceiptDialog open={open} onOpenChange={setOpen} onDone={(id) => router.push(`/purchase-orders/receipts/${id}`)} />
    </>
  );
}

function DirectReceiptDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: (id: string) => void }) {
  const receive = useReceiveGoods();
  const [supplierId, setSupplierId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [invoice, setInvoice] = useState("");
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = async () => {
    let invalid = !supplierId ? "Choose a supplier." : !locationId ? "Choose a location." : validateQuantities(lines);
    const bad = lines.find((l) => !COST.test((l.extra.cost ?? "").trim()));
    if (!invalid && bad) invalid = `Enter a unit cost for ${bad.item.name}.`;
    setProblem(invalid);
    if (invalid) return;
    try {
      const receipt = await receive.mutateAsync({
        supplier_id: supplierId,
        stock_location_id: locationId,
        supplier_invoice_no: invoice.trim() || null,
        lines: lines.map((l) => ({
          variant_id: l.item.variantId,
          unit_id: unitIdOrNull(l.unit),
          quantity: l.quantity.trim(),
          unit_cost: l.extra.cost.trim(),
        })),
      });
      setLines([]);
      onDone(receipt.id);
    } catch (e) {
      setProblem(errorMessage(e));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Direct receipt</DialogTitle>
          <DialogDescription>Receive goods without a purchase order (e.g. a walk-in delivery).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label>Supplier</Label>
              <SupplierSelect value={supplierId} onChange={setSupplierId} />
            </div>
            <div className="grid gap-2">
              <Label>Location</Label>
              <StockLocationSelect value={locationId} onChange={setLocationId} />
            </div>
            <TextField label="Invoice no." value={invoice} onChange={(e) => setInvoice(e.target.value)} />
          </div>
          <ItemLinesEditor
            lines={lines}
            onChange={setLines}
            extra={[{ key: "cost", label: "Unit cost", initial: (item) => (item.averageCost && Number(item.averageCost) > 0 ? item.averageCost : "") }]}
          />
          {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={receive.isPending}>
            Post receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
