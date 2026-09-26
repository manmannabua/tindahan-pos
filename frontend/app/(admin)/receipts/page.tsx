"use client";

import { ReceiptTextIcon } from "lucide-react";
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
import { useReceipts } from "@/features/receipts/api";
import { PrintedBadge, ReceiptViewerDialog } from "@/features/receipts/components/receipt-viewer-dialog";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 25;
const ALL = "__all__";

/** Local calendar day → ISO timestamps for the API (inclusive start, exclusive end). */
function dayStart(date: string): string {
  return new Date(`${date}T00:00:00`).toISOString();
}
function dayEnd(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

export default function ReceiptsPage() {
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(isoDate(new Date()));
  const [branchId, setBranchId] = useState(ALL);
  const [printed, setPrinted] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const q = useDebouncedValue(search.trim());
  const { data: branches } = useBranches();
  const branchLabels = useBranchLabels();
  const { data, isPending, error, refetch, isPlaceholderData } = useReceipts({
    q: q || undefined,
    kind: kind === ALL ? undefined : (kind as "SALE" | "RETURN"),
    printed: printed === ALL ? undefined : printed === "yes",
    branch_id: branchId === ALL ? undefined : branchId,
    issued_from: from ? dayStart(from) : undefined,
    issued_to: to ? dayEnd(to) : undefined,
    limit: PAGE_SIZE,
    offset,
  });
  const reset =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setOffset(0);
    };

  return (
    <>
      <PageHeader
        title="Receipts"
        description="Every receipt issued by your terminals, exactly as the customer got it — printed or not."
      />
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
        <SearchInput value={search} onChange={reset(setSearch)} placeholder="Receipt or return number" />
        <div className="flex gap-3">
          <div className="w-40">
            <TextField label="From" type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} />
          </div>
          <div className="w-40">
            <TextField label="To" type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} />
          </div>
        </div>
        {(branches?.length ?? 0) > 1 && (
          <SimpleSelect
            aria-label="Branch"
            className="w-full lg:w-44"
            value={branchId}
            onChange={reset(setBranchId)}
            options={[{ value: ALL, label: "All branches" }, ...(branches ?? []).map((b) => ({ value: b.id, label: b.name }))]}
          />
        )}
        <SimpleSelect
          aria-label="Printed"
          className="w-full lg:w-40"
          value={printed}
          onChange={reset(setPrinted)}
          options={[
            { value: ALL, label: "Printed or not" },
            { value: "yes", label: "Printed" },
            { value: "no", label: "Not printed" },
          ]}
        />
        <SimpleSelect
          aria-label="Type"
          className="w-full lg:w-36"
          value={kind}
          onChange={reset(setKind)}
          options={[
            { value: ALL, label: "All types" },
            { value: "SALE", label: "Sales" },
            { value: "RETURN", label: "Returns" },
          ]}
        />
      </div>

      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={ReceiptTextIcon} title="No receipts" description="Receipts appear here once terminals sync." />
      ) : (
        <div className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Receipt</TableHead>
                  <TableHead className="hidden md:table-cell">Issued</TableHead>
                  <TableHead className="hidden lg:table-cell">Branch · terminal</TableHead>
                  <TableHead className="hidden sm:table-cell">Cashier</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="w-32">Printed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((r) => (
                  <TableRow key={r.id} className="h-12 cursor-pointer" onClick={() => setOpen(r.id)}>
                    <TableCell className="font-medium">
                      {r.number}
                      {r.kind === "RETURN" && (
                        <Badge variant="outline" className="ml-2">
                          Return
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">{formatDateTime(r.issued_at)}</TableCell>
                    <TableCell className="hidden lg:table-cell">
                      {branchLabels[r.branch_id] ?? ""} · {r.terminal_code}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{r.cashier_name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.kind === "RETURN" ? "-" : ""}
                      {money(r.total)}
                    </TableCell>
                    <TableCell>
                      <PrintedBadge count={r.print_count} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </div>
      )}
      <ReceiptViewerDialog receiptId={open} onClose={() => setOpen(null)} />
    </>
  );
}
