"use client";

import { CircleIcon, MonitorSmartphoneIcon } from "lucide-react";

import { EmptyState } from "@/components/shared/empty-state";
import { humanize } from "@/components/shared/formatters";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranchLabels } from "@/features/branches/api";
import { useSyncMonitor } from "@/features/management/api";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function SyncMonitorPage() {
  const { data, isPending, error, refetch, dataUpdatedAt } = useSyncMonitor();
  const branches = useBranchLabels();
  const terminal = new Map((data?.devices ?? []).map((d) => [d.id, `${branches[d.branch_id]?.split(" · ")[0] ?? ""}-${d.terminal_code}`]));

  return (
    <>
      <PageHeader
        title="Sync monitor"
        description={dataUpdatedAt ? `Terminal health and operations needing attention · updated ${new Date(dataUpdatedAt).toLocaleTimeString()}` : undefined}
      />
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : (
        <div className="grid gap-6">
          {data.devices.length === 0 ? (
            <EmptyState icon={MonitorSmartphoneIcon} title="No active terminals" description="Register a terminal from /pos/setup on the device." />
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Terminal</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="hidden md:table-cell">Last sync</TableHead>
                    <TableHead className="text-right">Pending</TableHead>
                    <TableHead className="hidden lg:table-cell">Version</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.devices.map((d) => (
                    <TableRow key={d.id} className="h-11">
                      <TableCell>
                        <p className="font-medium">{d.name}</p>
                        <p className="font-mono text-xs text-muted-foreground">{terminal.get(d.id)}</p>
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-sm">
                          <CircleIcon className={cn("size-2.5 fill-current", d.online ? "text-emerald-500" : "text-muted-foreground")} />
                          {d.online ? "Online" : "Offline"}
                          {d.stale && <Badge variant="outline" className="text-amber-600">Not synced 1h+</Badge>}
                        </span>
                      </TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{formatDateTime(d.last_sync_at)}</TableCell>
                      <TableCell className={cn("text-right tabular-nums", (d.pending_operations ?? 0) > 0 && "font-medium text-amber-600")}>
                        {d.pending_operations ?? "—"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">{d.app_version ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle>Failed operations (30 days)</CardTitle>
            </CardHeader>
            <CardContent>
              {data.failed_operations.length === 0 ? (
                <p className="text-sm text-muted-foreground">No rejected or conflicting operations.</p>
              ) : (
                <ul className="divide-y">
                  {data.failed_operations.map((op) => (
                    <li key={op.id} className="py-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={op.status === "CONFLICT" ? "outline" : "destructive"}>{humanize(op.status)}</Badge>
                        <span className="font-mono">{op.operation}</span>
                        <span className="text-muted-foreground">
                          {terminal.get(op.device_id) ?? op.device_id.slice(0, 8)} · {formatDateTime(op.received_at)}
                        </span>
                      </div>
                      {op.error && (
                        <p className="mt-1 text-muted-foreground">
                          <span className="font-mono">{String(op.error.code ?? "")}</span> {String(op.error.message ?? "")}
                        </p>
                      )}
                      <p className="mt-1 font-mono text-xs text-muted-foreground">
                        {op.entity_type} {op.entity_id}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
