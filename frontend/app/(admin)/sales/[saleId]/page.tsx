"use client";

import { ArrowLeftIcon, BanIcon, ReceiptTextIcon, TriangleAlertIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { TextField } from "@/components/shared/form-fields";
import { humanize, money, qty } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermission } from "@/features/auth/hooks";
import { useBranchLabels } from "@/features/branches/api";
import { useLabels } from "@/features/catalog/api";
import { useReceipts } from "@/features/receipts/api";
import { ReceiptViewerDialog } from "@/features/receipts/components/receipt-viewer-dialog";
import { useSale, useVoidSale } from "@/features/sales/api";
import { ReturnDialog } from "@/features/sales/components/return-dialog";
import { ADMIN_PERM } from "@/features/shell/permissions";
import { errorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";
import { add, isZero } from "@/lib/money";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between font-semibold" : "flex justify-between text-muted-foreground"}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export default function SaleDetailPage() {
  const { saleId } = useParams<{ saleId: string }>();
  const router = useRouter();
  const { data: sale, isPending, error, refetch } = useSale(saleId);
  const methods = useLabels("payment-methods", (m) => m.name);
  const branches = useBranchLabels();
  const canVoid = usePermission(ADMIN_PERM.SALES_VOID, sale?.branch_id);
  const canReturn = usePermission(ADMIN_PERM.RETURNS_CREATE, sale?.branch_id);
  const voidSale = useVoidSale(saleId);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [returning, setReturning] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const receipts = useReceipts({ sale_id: saleId, kind: "SALE", limit: 1, offset: 0 }, Boolean(saleId));
  const saleReceipt = receipts.data?.items[0];

  if (isPending) return <TableSkeleton />;
  if (error) return <QueryError error={error} onRetry={() => void refetch()} />;
  const completed = sale.status === "COMPLETED";

  return (
    <>
      <Link href="/sales" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" /> Sales
      </Link>
      <PageHeader
        title={`Receipt ${sale.receipt_number}`}
        description={`${formatDateTime(sale.occurred_at)} · ${branches[sale.branch_id] ?? ""} · synced ${formatDateTime(sale.received_at)}`}
        actions={
          <>
            <Badge variant={completed ? "secondary" : "destructive"}>{humanize(sale.status)}</Badge>
            {saleReceipt && (
              <Button variant="outline" onClick={() => setViewing(saleReceipt.id)}>
                <ReceiptTextIcon /> View receipt
              </Button>
            )}
            {completed && canReturn && (
              <Button variant="outline" onClick={() => setReturning(true)}>
                <Undo2Icon /> Return items
              </Button>
            )}
            {completed && canVoid && (
              <Button variant="destructive" onClick={() => setVoiding(true)}>
                <BanIcon /> Void sale
              </Button>
            )}
          </>
        }
      />
      {sale.totals_mismatch && (
        <Alert className="mb-4">
          <TriangleAlertIcon />
          <AlertTitle>Totals differ from the server&apos;s calculation</AlertTitle>
          <AlertDescription>
            The amounts below are what the customer was charged. See <Link href="/review-flags" className="underline">review flags</Link>.
          </AlertDescription>
        </Alert>
      )}
      {sale.status === "VOIDED" && (
        <Alert variant="destructive" className="mb-4">
          <BanIcon />
          <AlertTitle>Voided {formatDateTime(sale.voided_at)}</AlertTitle>
          <AlertDescription>{sale.void_reason}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="hidden text-right sm:table-cell">Price</TableHead>
                <TableHead className="hidden text-right md:table-cell">Discount</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sale.items.map((i) => {
                const discount = add(i.line_discount, i.order_discount_share).toFixed(2);
                return (
                  <TableRow key={i.id}>
                    <TableCell>
                      <p>
                        {i.product_name}
                        {i.variant_name && ` · ${i.variant_name}`}
                      </p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {i.sku}
                        {i.tax_kind !== "VATABLE" && ` · ${humanize(i.tax_kind)}`}
                      </p>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {qty(i.quantity)} {i.unit_code}
                    </TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{money(i.unit_price)}</TableCell>
                    <TableCell className="hidden text-right tabular-nums md:table-cell">{isZero(discount) ? "—" : money(discount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(i.total)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Totals</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Row label="Gross" value={money(sale.gross_total)} />
              <Row label="Discounts" value={money(sale.discount_total)} />
              <Row label="VATable sales" value={money(sale.vatable_sales)} />
              <Row label="VAT" value={money(sale.vat_amount)} />
              {!isZero(sale.exempt_sales) && <Row label="VAT-exempt sales" value={money(sale.exempt_sales)} />}
              {!isZero(sale.zero_rated_sales) && <Row label="Zero-rated sales" value={money(sale.zero_rated_sales)} />}
              <Row label="Total" value={money(sale.total)} strong />
              <Row label="Paid" value={money(sale.paid_total)} />
              <Row label="Change" value={money(sale.change_total)} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Payments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {sale.payments.map((p) => (
                <div key={p.id} className="flex items-start justify-between gap-2">
                  <div>
                    <p>{methods[p.payment_method_id] ?? humanize(p.method_kind)}</p>
                    {p.reference_no && <p className="font-mono text-xs text-muted-foreground">{p.reference_no}</p>}
                    {p.status !== "CAPTURED" && <Badge variant="outline">{humanize(p.status)}</Badge>}
                  </div>
                  <span className="tabular-nums">{money(p.amount)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={voiding} onOpenChange={setVoiding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Void {sale.receipt_number}?</DialogTitle>
            <DialogDescription>
              The whole sale is cancelled and its items return to stock. Only possible while its shift is open; otherwise record a return.
            </DialogDescription>
          </DialogHeader>
          <TextField label="Reason" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoiding(false)}>
              Keep sale
            </Button>
            <Button
              variant="destructive"
              disabled={voidReason.trim().length < 3 || voidSale.isPending}
              onClick={() =>
                voidSale.mutate(voidReason.trim(), {
                  onSuccess: () => {
                    toast.success("Sale voided");
                    setVoiding(false);
                  },
                  onError: (e) => toast.error(errorMessage(e)),
                })
              }
            >
              Void sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {returning && <ReturnDialog sale={sale} onClose={() => setReturning(false)} onDone={(id) => router.push(`/sales/returns/${id}`)} />}
      <ReceiptViewerDialog receiptId={viewing} onClose={() => setViewing(null)} />
    </>
  );
}
