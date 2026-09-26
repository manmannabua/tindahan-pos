"use client";

import { PackageCheckIcon, PlusIcon, ShoppingCartIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { SimpleSelect } from "@/components/shared/form-fields";
import { humanize, money } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { usePurchaseOrders, useSupplierLabels } from "@/features/purchasing/api";
import { SupplierSelect } from "@/features/purchasing/components/supplier-select";
import { PO_BADGE, PO_STATUSES } from "@/features/purchasing/po-status";
import { ADMIN_PERM } from "@/features/shell/permissions";

const PAGE_SIZE = 25;
const ALL = "__all__";

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const canManage = usePermissionInAnyScope(ADMIN_PERM.PURCHASING_MANAGE);
  const [status, setStatus] = useState(ALL);
  const [supplierId, setSupplierId] = useState("");
  const [offset, setOffset] = useState(0);
  const suppliers = useSupplierLabels();
  const { data, isPending, error, refetch } = usePurchaseOrders({
    status: status === ALL ? undefined : status,
    supplier_id: supplierId || undefined,
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <>
      <PageHeader
        title="Purchase orders"
        actions={
          <>
            <Link href="/purchase-orders/receipts" className={buttonVariants({ variant: "outline" })}>
              <PackageCheckIcon /> Goods receipts
            </Link>
            {canManage && (
              <Link href="/purchase-orders/new" className={buttonVariants()}>
                <PlusIcon /> New order
              </Link>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <SimpleSelect
          aria-label="Status"
          className="w-full sm:w-56"
          value={status}
          onChange={(v) => { setStatus(v); setOffset(0); }}
          options={[{ value: ALL, label: "All statuses" }, ...PO_STATUSES.map((s) => ({ value: s, label: humanize(s) }))]}
        />
        <div className="w-full sm:w-64">
          <SupplierSelect allowAll value={supplierId} onChange={(v) => { setSupplierId(v); setOffset(0); }} />
        </div>
      </div>
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={ShoppingCartIcon} title="No purchase orders" />
      ) : (
        <>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="hidden md:table-cell">Ordered</TableHead>
                  <TableHead className="hidden md:table-cell">Expected</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-40">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((po) => (
                  <TableRow key={po.id} className="h-11 cursor-pointer" onClick={() => router.push(`/purchase-orders/${po.id}`)}>
                    <TableCell className="font-mono">{po.number}</TableCell>
                    <TableCell>{suppliers[po.supplier_id] ?? "—"}</TableCell>
                    <TableCell className="hidden md:table-cell">{po.order_date}</TableCell>
                    <TableCell className="hidden md:table-cell">{po.expected_date ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(po.total)}</TableCell>
                    <TableCell>
                      <Badge variant={PO_BADGE[po.status] ?? "outline"}>{humanize(po.status)}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </>
      )}
    </>
  );
}
