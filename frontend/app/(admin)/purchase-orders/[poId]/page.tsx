"use client";

import { ArrowLeftIcon, PackageCheckIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { TextField } from "@/components/shared/form-fields";
import { humanize, money, qty } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { useLocationLabels, useVariantNamesAt } from "@/features/inventory/api";
import { usePurchaseOrder, usePurchaseOrderAction, useReceipts, useReceiveGoods, useSupplierLabels } from "@/features/purchasing/api";
import { PO_BADGE, remainingInOrderedUnit } from "@/features/purchasing/po-status";
import { ADMIN_PERM } from "@/features/shell/permissions";
import { errorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";
import { isValidDecimal, toBig } from "@/lib/money";

export default function PurchaseOrderPage() {
  const { poId } = useParams<{ poId: string }>();
  const { data: po, isPending, error, refetch } = usePurchaseOrder(poId);
  const suppliers = useSupplierLabels();
  const locations = useLocationLabels();
  const names = useVariantNamesAt(po?.stock_location_id);
  const receipts = useReceipts({ purchase_order_id: poId, limit: 50, offset: 0 });
  const action = usePurchaseOrderAction(poId);
  const receive = useReceiveGoods();
  const canManage = usePermissionInAnyScope(ADMIN_PERM.PURCHASING_MANAGE);
  const canReceive = usePermissionInAnyScope(ADMIN_PERM.PURCHASING_RECEIVE);
  const [confirm, setConfirm] = useState<"approve" | "cancel" | "close" | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [invoice, setInvoice] = useState("");

  // Default "receive now" to the remaining quantities whenever a new version of the order loads.
  const [syncedFrom, setSyncedFrom] = useState(po);
  if (po !== syncedFrom) {
    setSyncedFrom(po);
    if (po) setQuantities(Object.fromEntries(po.lines.map((l) => [l.id, remainingInOrderedUnit(l)])));
  }

  if (isPending) return <TableSkeleton />;
  if (error) return <QueryError error={error} onRetry={() => void refetch()} />;

  const receivable = po.status === "APPROVED" || po.status === "PARTIALLY_RECEIVED";
  const submitReceipt = () => {
    const lines = po.lines
      .filter((l) => isValidDecimal(quantities[l.id] ?? "") && toBig(quantities[l.id]).gt("0"))
      .map((l) => ({ purchase_order_line_id: l.id, quantity: toBig(quantities[l.id]).toString() }));
    if (lines.length === 0) {
      toast.error("Enter at least one received quantity.");
      return;
    }
    receive.mutate(
      { purchase_order_id: po.id, supplier_invoice_no: invoice.trim() || null, lines },
      {
        onSuccess: (r) => {
          toast.success(`Received as ${r.number}`);
          setInvoice("");
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  };

  return (
    <>
      <Link href="/purchase-orders" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Purchase orders
      </Link>
      <PageHeader
        title={`${po.number} · ${suppliers[po.supplier_id] ?? ""}`}
        description={`Deliver to ${locations[po.stock_location_id] ?? "—"} · ordered ${po.order_date}${po.expected_date ? ` · expected ${po.expected_date}` : ""}`}
        actions={
          <>
            <Badge variant={PO_BADGE[po.status] ?? "outline"}>{humanize(po.status)}</Badge>
            {canManage && po.status === "DRAFT" && <Button onClick={() => setConfirm("approve")}>Approve</Button>}
            {canManage && (po.status === "DRAFT" || po.status === "APPROVED") && (
              <Button variant="outline" onClick={() => setConfirm("cancel")}>
                Cancel
              </Button>
            )}
            {canManage && po.status === "PARTIALLY_RECEIVED" && (
              <Button variant="outline" onClick={() => setConfirm("close")}>
                Close short
              </Button>
            )}
          </>
        }
      />
      {po.notes && <p className="mb-4 text-sm text-muted-foreground">{po.notes}</p>}

      <div className="grid gap-6">
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Ordered</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Unit cost</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Received (base)</TableHead>
                {receivable && canReceive && <TableHead className="w-36 text-right">Receive now</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {po.lines.map((l) => (
                <TableRow key={l.id} className="h-11">
                  <TableCell>{names[l.variant_id] ?? `Item ${l.line_no}`}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {qty(l.quantity)}
                    {!toBig(l.unit_factor).eq("1") && <span className="text-muted-foreground"> ×{qty(l.unit_factor)}</span>}
                  </TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{money(l.unit_cost)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(l.line_total)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {qty(l.received_base_quantity)} / {qty(l.base_quantity)}
                  </TableCell>
                  {receivable && canReceive && (
                    <TableCell className="text-right">
                      <Input
                        aria-label={`Receive quantity line ${l.line_no}`}
                        className="ml-auto h-8 w-24 text-right"
                        inputMode="decimal"
                        value={quantities[l.id] ?? ""}
                        onChange={(e) => setQuantities({ ...quantities, [l.id]: e.target.value })}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
              <TableRow>
                <TableCell colSpan={3} className="text-right font-medium">
                  Total
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{money(po.total)}</TableCell>
                <TableCell colSpan={receivable && canReceive ? 2 : 1} />
              </TableRow>
            </TableBody>
          </Table>
        </div>

        {receivable && canReceive && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <PackageCheckIcon className="size-4" /> Receive goods
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="sm:w-72">
                <TextField label="Supplier invoice no." value={invoice} onChange={(e) => setInvoice(e.target.value)} />
              </div>
              <Button onClick={submitReceipt} disabled={receive.isPending}>
                {receive.isPending ? "Posting…" : "Post receipt"}
              </Button>
              <p className="text-xs text-muted-foreground">Quantities are in each line&apos;s ordered unit. Costs update the moving average.</p>
            </CardContent>
          </Card>
        )}

        {(receipts.data?.items.length ?? 0) > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Receipts</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {receipts.data?.items.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-2">
                    <Link href={`/purchase-orders/receipts/${r.id}`} className="font-mono hover:underline">
                      {r.number}
                    </Link>
                    <span className="text-muted-foreground">{formatDateTime(r.received_at)}</span>
                    <span className="tabular-nums">{money(r.total_cost)}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(v) => !v && setConfirm(null)}
        title={confirm === "approve" ? "Approve this order?" : confirm === "cancel" ? "Cancel this order?" : "Close this order short?"}
        description={
          confirm === "approve"
            ? "Approved orders can be received."
            : confirm === "cancel"
              ? "The order will not be received."
              : "The remaining quantities will not arrive; the order is closed as is."
        }
        confirmLabel={confirm === "approve" ? "Approve" : confirm === "cancel" ? "Cancel order" : "Close order"}
        destructive={confirm !== "approve"}
        pending={action.isPending}
        onConfirm={() =>
          confirm &&
          action.mutate(confirm, {
            onSuccess: () => setConfirm(null),
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </>
  );
}
