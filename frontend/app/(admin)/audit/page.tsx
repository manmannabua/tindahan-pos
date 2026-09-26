"use client";

import { HistoryIcon } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuditLogs } from "@/features/audit/api";
import { AuditTable } from "@/features/audit/components/audit-table";
import { useBranchLabels } from "@/features/branches/api";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export default function AuditPage() {
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const filters = useDebouncedValue({ action: action.trim(), entityType: entityType.trim() }, 400);
  const branchLabels = useBranchLabels();
  const { data, isPending, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useAuditLogs(filters);
  const entries = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of sensitive actions. Newest first." />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:w-2/3">
        <Input
          placeholder="Action, e.g. auth.login_failed"
          className="h-10 font-mono"
          value={action}
          onChange={(e) => setAction(e.target.value)}
          aria-label="Filter by action"
        />
        <Input
          placeholder="Entity type, e.g. user"
          className="h-10 font-mono"
          value={entityType}
          onChange={(e) => setEntityType(e.target.value)}
          aria-label="Filter by entity type"
        />
      </div>
      {isPending ? (
        <TableSkeleton rows={8} />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : entries.length === 0 ? (
        <EmptyState icon={HistoryIcon} title="No matching entries" />
      ) : (
        <>
          <AuditTable entries={entries} branchLabels={branchLabels} />
          <div className="mt-4 flex justify-center">
            {hasNextPage ? (
              <Button variant="outline" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">End of log</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
