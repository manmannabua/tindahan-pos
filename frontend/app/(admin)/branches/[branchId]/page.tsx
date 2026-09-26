"use client";

import { ArrowLeftIcon, PencilIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { ActiveBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { usePermission } from "@/features/auth/hooks";
import { useBranch, useUpdateBranch } from "@/features/branches/api";
import { BranchFormDialog } from "@/features/branches/components/branch-form-dialog";
import { LocationFormDialog } from "@/features/branches/components/location-form-dialog";
import { LocationsTable } from "@/features/branches/components/locations-table";
import { errorMessage } from "@/lib/api/errors";
import { PERM } from "@/lib/auth/permissions";

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm whitespace-pre-line">{value || "—"}</dd>
    </div>
  );
}

export default function BranchDetailPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const { data: branch, isPending, error, refetch } = useBranch(branchId);
  const canManage = usePermission(PERM.BRANCHES_MANAGE, branchId);
  const update = useUpdateBranch(branchId);
  const [editing, setEditing] = useState(false);
  const [addingLocation, setAddingLocation] = useState(false);

  const back = (
    <Link href="/branches" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeftIcon className="size-4" /> Branches
    </Link>
  );

  if (isPending) return (<>{back}<TableSkeleton rows={3} /></>);
  if (error) return (<>{back}<QueryError error={error} onRetry={() => void refetch()} /></>);

  const toggleActive = () =>
    update.mutate(
      { is_active: !branch.is_active },
      {
        onSuccess: () => toast.success(branch.is_active ? "Branch deactivated" : "Branch activated"),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <>
      {back}
      <PageHeader
        title={`${branch.code} · ${branch.name}`}
        actions={
          canManage && (
            <>
              <Button variant="outline" onClick={toggleActive} disabled={update.isPending}>
                {branch.is_active ? "Deactivate" : "Activate"}
              </Button>
              <Button onClick={() => setEditing(true)}>
                <PencilIcon /> Edit
              </Button>
            </>
          )
        }
      />
      <div className="grid gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Details</CardTitle>
            <ActiveBadge active={branch.is_active} />
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-3">
              <Detail label="Address" value={branch.address} />
              <Detail label="Phone" value={branch.phone} />
              <Detail label="TIN" value={branch.tin} />
              <Detail label="Receipt header" value={branch.receipt_header} />
              <Detail label="Receipt footer" value={branch.receipt_footer} />
            </dl>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Stock locations</h2>
            {canManage && (
              <Button variant="outline" onClick={() => setAddingLocation(true)}>
                <PlusIcon /> Add location
              </Button>
            )}
          </div>
          <LocationsTable branchId={branch.id} locations={branch.locations} canManage={canManage} />
        </section>
      </div>

      <BranchFormDialog open={editing} onOpenChange={setEditing} branch={branch} />
      <LocationFormDialog branchId={branch.id} open={addingLocation} onOpenChange={setAddingLocation} />
    </>
  );
}
