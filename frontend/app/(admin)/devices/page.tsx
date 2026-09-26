"use client";

import { MonitorSmartphoneIcon } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { SimpleSelect } from "@/components/shared/form-fields";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranches, useBranchLabels } from "@/features/branches/api";
import { useDevices } from "@/features/devices/api";
import { RevokeDeviceDialog } from "@/features/devices/components/revoke-device-dialog";
import { formatDateTime } from "@/lib/format";
import type { Device } from "@/types/api";

const ALL = "__all__";

export default function DevicesPage() {
  const [branchFilter, setBranchFilter] = useState(ALL);
  const { data: branches = [] } = useBranches();
  const branchLabels = useBranchLabels();
  const { data: devices, isPending, error, refetch } = useDevices(branchFilter === ALL ? null : branchFilter);
  const [revoking, setRevoking] = useState<Device | null>(null);

  return (
    <>
      <PageHeader
        title="Devices"
        description="POS terminals. Terminals are registered from the terminal itself (Open POS terminal → setup)."
        actions={
          <SimpleSelect
            aria-label="Filter by branch"
            className="w-56"
            value={branchFilter}
            onChange={setBranchFilter}
            options={[{ value: ALL, label: "All branches" }, ...branches.map((b) => ({ value: b.id, label: `${b.code} · ${b.name}` }))]}
          />
        }
      />
      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : devices.length === 0 ? (
        <EmptyState
          icon={MonitorSmartphoneIcon}
          title="No terminals registered"
          description="Open the POS on the terminal's browser and follow the setup steps to register it."
        />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Terminal</TableHead>
                <TableHead className="hidden md:table-cell">Branch</TableHead>
                <TableHead className="hidden lg:table-cell">Last seen</TableHead>
                <TableHead className="hidden lg:table-cell">Last sync</TableHead>
                <TableHead className="w-24 text-right">Pending</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((device) => (
                <TableRow key={device.id} className="h-14">
                  <TableCell>
                    <div className="font-medium">
                      <span className="font-mono">{device.terminal_code}</span> · {device.name}
                    </div>
                    <div className="max-w-64 truncate text-xs text-muted-foreground">
                      {device.platform ?? "Unknown platform"}
                      {device.app_version && ` · v${device.app_version}`}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">{branchLabels[device.branch_id] ?? "—"}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{formatDateTime(device.last_seen_at)}</TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">{formatDateTime(device.last_sync_at)}</TableCell>
                  <TableCell className="text-right tabular-nums">{device.pending_operations ?? "—"}</TableCell>
                  <TableCell>
                    {device.status === "ACTIVE" ? (
                      <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="destructive">Revoked</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {device.status === "ACTIVE" && (
                      <Button variant="ghost" size="sm" onClick={() => setRevoking(device)}>
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <RevokeDeviceDialog device={revoking} onOpenChange={(open) => !open && setRevoking(null)} />
    </>
  );
}
