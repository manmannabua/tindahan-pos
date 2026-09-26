"use client";

import { Building2Icon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { ActiveBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { usePermissionInAnyScope } from "@/features/auth/hooks";
import { useBranches } from "@/features/branches/api";
import { BranchFormDialog } from "@/features/branches/components/branch-form-dialog";
import { PERM } from "@/lib/auth/permissions";

export default function BranchesPage() {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const canManage = usePermissionInAnyScope(PERM.BRANCHES_MANAGE);
  const { data, isPending, error, refetch } = useBranches(includeInactive);
  const router = useRouter();

  return (
    <>
      <PageHeader
        title="Branches"
        description="Physical stores. Each branch sells from its default stock location."
        actions={
          canManage && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              New branch
            </Button>
          )
        }
      />
      <div className="mb-4 flex items-center gap-2">
        <Switch id="inactive-branches" checked={includeInactive} onCheckedChange={setIncludeInactive} />
        <Label htmlFor="inactive-branches">Show inactive</Label>
      </div>

      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.length === 0 ? (
        <EmptyState icon={Building2Icon} title="No branches" description="Create your first branch to start selling." />
      ) : (
        <div className="rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Code</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="hidden md:table-cell">Phone</TableHead>
                <TableHead className="w-28">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((branch) => (
                <TableRow
                  key={branch.id}
                  className="h-12 cursor-pointer"
                  onClick={() => router.push(`/branches/${branch.id}`)}
                >
                  <TableCell className="font-mono font-medium">{branch.code}</TableCell>
                  <TableCell>{branch.name}</TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{branch.phone ?? "—"}</TableCell>
                  <TableCell>
                    <ActiveBadge active={branch.is_active} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <BranchFormDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(branch) => router.push(`/branches/${branch.id}`)}
      />
    </>
  );
}
