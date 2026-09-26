"use client";

import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { money, qty } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLabels } from "@/features/catalog/api";
import { useSale, useSaleReturn } from "@/features/sales/api";
import { formatDateTime } from "@/lib/format";

export default function ReturnPage() {
  const { returnId } = useParams<{ returnId: string }>();
  const { data: ret, isPending, error, refetch } = useSaleReturn(returnId);
  const sale = useSale(ret?.original_sale_id ?? "");
  const methods = useLabels("payment-methods", (m) => m.name);

  if (isPending) return <TableSkeleton />;
  if (error) return <QueryError error={error} onRetry={() => void refetch()} />;
  const itemName = (saleItemId: string) => {
    const item = sale.data?.items.find((i) => i.id === saleItemId);
    return item ? `${item.product_name}${item.variant_name ? ` · ${item.variant_name}` : ""}` : "Item";
  };

  return (
    <>
      <Link href={`/sales/${ret.original_sale_id}`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Receipt {sale.data?.receipt_number ?? ""}
      </Link>
      <PageHeader title={`Return ${ret.return_number}`} description={`${formatDateTime(ret.occurred_at)} · ${ret.reason}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Restocked</TableHead>
                <TableHead className="text-right">Refund</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ret.items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell>{itemName(i.sale_item_id)}</TableCell>
                  <TableCell className="text-right tabular-nums">{qty(i.quantity)}</TableCell>
                  <TableCell>{i.restock ? "Yes" : "No (write-off)"}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(i.refund_amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Refunded {money(ret.refund_total)}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {ret.refunds.map((r) => (
              <div key={r.id} className="flex justify-between">
                <span>
                  {methods[r.payment_method_id] ?? r.method_kind}
                  {r.reference_no && <span className="ml-1 font-mono text-xs text-muted-foreground">{r.reference_no}</span>}
                </span>
                <span className="tabular-nums">{money(r.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
