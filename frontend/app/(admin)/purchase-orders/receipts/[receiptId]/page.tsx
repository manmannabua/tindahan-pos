"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { money, qty } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLocationLabels, useVariantNamesAt } from "@/features/inventory/api";
import { useReceipt, useSupplierLabels } from "@/features/purchasing/api";
import { formatDateTime } from "@/lib/format";

export default function GoodsReceiptPage() {
  const { receiptId } = useParams<{ receiptId: string }>();
  const { data: receipt, isPending, error, refetch } = useReceipt(receiptId);
  const suppliers = useSupplierLabels();
  const locations = useLocationLabels();
  const names = useVariantNamesAt(receipt?.stock_location_id);

  if (isPending) return <TableSkeleton />;
  if (error) return <QueryError error={error} onRetry={() => void refetch()} />;

  return (
    <>
      <Link href="/purchase-orders/receipts" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Goods receipts
      </Link>
      <PageHeader
        title={`Receipt ${receipt.number}`}
        description={[
          suppliers[receipt.supplier_id],
          locations[receipt.stock_location_id],
          formatDateTime(receipt.received_at),
          receipt.supplier_invoice_no ? `invoice ${receipt.supplier_invoice_no}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          receipt.purchase_order_id && (
            <Link href={`/purchase-orders/${receipt.purchase_order_id}`} className="text-sm hover:underline">
              View purchase order
            </Link>
          )
        }
      />
      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Base qty</TableHead>
              <TableHead className="text-right">Unit cost</TableHead>
              <TableHead className="hidden text-right md:table-cell">Cost / base unit</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {receipt.lines.map((l) => (
              <TableRow key={l.id} className="h-11">
                <TableCell>
                  {names[l.variant_id] ?? `Line ${l.line_no}`}
                  {(l.lot_no || l.expiry_date) && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {l.lot_no && `lot ${l.lot_no}`} {l.expiry_date && `exp ${l.expiry_date}`}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{qty(l.quantity)}</TableCell>
                <TableCell className="hidden text-right tabular-nums sm:table-cell">{qty(l.base_quantity)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(l.unit_cost)}</TableCell>
                <TableCell className="hidden text-right tabular-nums md:table-cell">{money(l.base_unit_cost)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(l.line_total)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={5} className="text-right font-medium">
                Total
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{money(receipt.total_cost)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </>
  );
}
