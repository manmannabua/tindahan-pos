"use client";

import { CheckCircle2Icon, FlagIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/shared/empty-state";
import { SimpleSelect, TextAreaField } from "@/components/shared/form-fields";
import { humanize } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { Pagination } from "@/components/shared/pagination";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useBranchLabels } from "@/features/branches/api";
import { flagEntityHref, useResolveFlag, useReviewFlags } from "@/features/management/api";
import { errorMessage } from "@/lib/api/errors";
import { formatDateTime } from "@/lib/format";
import type { ReviewFlag } from "@/types/api-admin";

const PAGE_SIZE = 25;
const ALL = "__all__";
const FLAG_TYPES = [
  "NEGATIVE_INVENTORY",
  "TOTAL_MISMATCH",
  "CASH_SESSION_MISMATCH",
  "USER_NOT_AUTHORIZED",
  "CLOCK_SKEW",
  "BALANCE_DRIFT",
  "TRANSFER_DISCREPANCY",
  "DUPLICATE_CUSTOMER",
];

const EXPLANATIONS: Record<string, string> = {
  NEGATIVE_INVENTORY: "Sales made stock go below zero — usually two terminals sold the same stock offline. Count the item.",
  TOTAL_MISMATCH: "A terminal's totals differ from the server's recalculation. The charged amounts were kept.",
  CASH_SESSION_MISMATCH: "The drawer's expected cash reported by the terminal differs from the server's figure.",
  USER_NOT_AUTHORIZED: "Someone acted without the needed permission (checked when the terminal synced).",
  CLOCK_SKEW: "A terminal's clock is more than 5 minutes off. Fix the device's time.",
  BALANCE_DRIFT: "A stock balance no longer matches the ledger sum.",
  TRANSFER_DISCREPANCY: "Fewer units arrived than were sent.",
  DUPLICATE_CUSTOMER: "Two customers share a phone number; consider merging them.",
};

function Details({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details).filter(([, v]) => v !== null && v !== undefined);
  if (entries.length === 0) return null;
  return (
    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      {entries.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{humanize(k)}</dt>
          <dd className="break-all font-mono">{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ReviewFlagsPage() {
  const [status, setStatus] = useState("OPEN");
  const [type, setType] = useState(ALL);
  const [offset, setOffset] = useState(0);
  const [resolving, setResolving] = useState<ReviewFlag | null>(null);
  const branches = useBranchLabels();
  const { data, isPending, error, refetch } = useReviewFlags({
    status: status === ALL ? undefined : status,
    flag_type: type === ALL ? undefined : type,
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <>
      <PageHeader title="Review flags" description="Anomalies the system recorded instead of rejecting sales. Resolve them after checking." />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <SimpleSelect
          aria-label="Status"
          className="w-full sm:w-44"
          value={status}
          onChange={(v) => { setStatus(v); setOffset(0); }}
          options={[
            { value: "OPEN", label: "Open" },
            { value: "RESOLVED", label: "Resolved" },
            { value: "DISMISSED", label: "Dismissed" },
            { value: ALL, label: "All" },
          ]}
        />
        <SimpleSelect
          aria-label="Type"
          className="w-full sm:w-64"
          value={type}
          onChange={(v) => { setType(v); setOffset(0); }}
          options={[{ value: ALL, label: "All types" }, ...FLAG_TYPES.map((t) => ({ value: t, label: humanize(t) }))]}
        />
      </div>
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={CheckCircle2Icon} title="Nothing to review" />
      ) : (
        <>
          <ul className="space-y-3">
            {data.items.map((f) => {
              const href = flagEntityHref(f);
              return (
                <li key={f.id} className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <FlagIcon className="size-4 text-amber-600" /> {humanize(f.flag_type)}
                        {f.occurrences > 1 && <Badge variant="outline">×{f.occurrences}</Badge>}
                        {f.status !== "OPEN" && <Badge variant="secondary">{humanize(f.status)}</Badge>}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{EXPLANATIONS[f.flag_type] ?? ""}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {f.branch_id && `${branches[f.branch_id] ?? ""} · `}first {formatDateTime(f.first_seen_at)} · last {formatDateTime(f.last_seen_at)}
                        {href && (
                          <>
                            {" · "}
                            <Link href={href} className="underline">
                              Open {humanize(f.entity_type).toLowerCase()}
                            </Link>
                          </>
                        )}
                      </p>
                      <Details details={f.details} />
                      {f.resolution_note && <p className="mt-2 text-sm">Note: {f.resolution_note}</p>}
                    </div>
                    {f.status === "OPEN" && (
                      <Button size="sm" variant="outline" onClick={() => setResolving(f)}>
                        Resolve
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <Pagination offset={offset} limit={PAGE_SIZE} total={data.total} shown={data.items.length} onChange={setOffset} />
        </>
      )}
      {resolving && <ResolveDialog flag={resolving} onClose={() => setResolving(null)} />}
    </>
  );
}

function ResolveDialog({ flag, onClose }: { flag: ReviewFlag; onClose: () => void }) {
  const resolve = useResolveFlag();
  const [note, setNote] = useState("");
  const run = (status: "RESOLVED" | "DISMISSED") =>
    resolve.mutate(
      { id: flag.id, status, note: note.trim() || null },
      {
        onSuccess: () => {
          toast.success(status === "RESOLVED" ? "Flag resolved" : "Flag dismissed");
          onClose();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{humanize(flag.flag_type)}</DialogTitle>
          <DialogDescription>Record what you checked or corrected (e.g. &quot;Counted; posted stock count CNT-000012&quot;).</DialogDescription>
        </DialogHeader>
        <TextAreaField label="Note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" disabled={resolve.isPending} onClick={() => run("DISMISSED")}>
            Dismiss
          </Button>
          <Button disabled={resolve.isPending} onClick={() => run("RESOLVED")}>
            Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
