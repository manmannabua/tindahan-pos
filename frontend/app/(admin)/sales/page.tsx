"use client";

import { ReceiptTextIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { SimpleSelect, TextField } from "@/components/shared/form-fields";
import { daysAgo, isoDate, money } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { SearchInput } from "@/components/shared/search-input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranches, useBranchLabels } from "@/features/branches/api";
import { useSales } from "@/features/sales/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 50;
const ALL = "__all__";

/** Local date → ISO timestamp at local midnight (the API filters on UTC instants). */
function dayStart(date: string): string | undefined {
  return date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
}

export default function SalesPage() {
  const router = useRouter();
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(isoDate(new Date()));
  const [branchId, setBranchId] = useState(ALL);
  const [receipt, setReceipt] = useState("");
  const [offset, setOffset] = useState(0);
  const receiptQ = useDebouncedValue(receipt.trim());
  const { data: branches } = useBranches();
  const branchLabels = useBranchLabels();
  const nextDay = to ? isoDate(new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000)) : "";
  const { data, isPending, error, refetch, isPlaceholderData } = useSales({
    occurred_from: receiptQ ? undefined : dayStart(from),
    occurred_to: receiptQ ? undefined : dayStart(nextDay),
    branch_id: branchId === ALL ? undefined : branchId,
    receipt_number: receiptQ || undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setOffset(0);
  };

  return (
    <>
      <PageHeader title="Sales" description="Sales from all terminals, as synced." />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end">
        <SearchInput value={receipt} onChange={reset(setReceipt)} placeholder="Exact receipt number" />
        <div className="w-40">
          <TextField label="From" type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
        </div>
        <div className="w-40">
          <TextField label="To" type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
        </div>
        <SimpleSelect
          aria-label="Branch"
          className="w-full lg:w-52"
          value={branchId}
          onChange={reset(setBranchId)}
          options={[{ value: ALL, label: "All branches" }, ...(branches ?? []).map((b) => ({ value: b.id, label: b.name }))]}
        />
      </div>
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={ReceiptTextIcon} title="No sales in this period" />
      ) : (
        <div className={isPlaceholderData ? "opacity-60" : undefined}>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead>When</TableHead>
                  <TableHead className="hidden md:table-cell">Branch</TableHead>
                  <TableHead className="hidden text-right sm:table-cell">Discount</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((s) => (
                  <TableRow key={s.id} className="h-11 cursor-pointer" onClick={() => router.push(`/sales/${s.id}`)}>
                    <TableCell className="font-mono">{s.receipt_number}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDateTime(s.occurred_at)}</TableCell>
                    <TableCell className="hidden md:table-cell">{branchLabels[s.branch_id] ?? "—"}</TableCell>
                    <TableCell className="hidden text-right tabular-nums sm:table-cell">{money(s.discount_total)}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">{money(s.total)}</TableCell>
                    <TableCell>
                      {s.status === "VOIDED" ? (
                        <Badge variant="destructive">Voided</Badge>
                      ) : s.totals_mismatch ? (
                        <Badge variant="outline" className="text-amber-600">Check totals</Badge>
                      ) : (
                        <Badge variant="secondary">Completed</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </div>
      )}
    </>
  );
}
