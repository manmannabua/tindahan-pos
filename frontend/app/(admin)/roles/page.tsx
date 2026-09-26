"use client";

import { LockIcon, PlusIcon, ShieldCheckIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { useDeleteRole, useRoles } from "@/features/roles/api";
import { RoleFormDialog } from "@/features/roles/components/role-form-dialog";
import { errorMessage } from "@/lib/api/errors";
import type { Role } from "@/types/api";

export default function RolesPage() {
  const { data: roles, isPending, error, refetch } = useRoles();
  const deleteRole = useDeleteRole();
  const [editing, setEditing] = useState<{ role: Role | null } | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);

  const confirmDelete = () =>
    deleting &&
    deleteRole.mutate(deleting.id, {
      onSuccess: () => {
        toast.success(`Role ${deleting.name} deleted`);
        setDeleting(null);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <>
      <PageHeader
        title="Roles"
        description="Roles bundle permissions. Assign them company-wide or per branch on the Users page."
        actions={
          <Button onClick={() => setEditing({ role: null })}>
            <PlusIcon /> New role
          </Button>
        }
      />
      {isPending ? (
        <TableSkeleton rows={4} />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : roles.length === 0 ? (
        <EmptyState icon={ShieldCheckIcon} title="No roles" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roles.map((role) => {
            const locked = role.code === "OWNER";
            return (
              <Card key={role.id}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {role.name}
                    {role.is_system && <Badge variant="outline">System</Badge>}
                  </CardTitle>
                  <CardDescription>{role.description ?? "No description"}</CardDescription>
                  <CardAction>
                    <span className="font-mono text-xs text-muted-foreground">{role.code}</span>
                  </CardAction>
                </CardHeader>
                <CardFooter className="mt-auto flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{role.permissions.length} permissions</span>
                  <div className="flex gap-2">
                    {!role.is_system && (
                      <Button variant="ghost" size="sm" onClick={() => setDeleting(role)}>
                        Delete
                      </Button>
                    )}
                    <Button variant="outline" size="sm" disabled={locked} onClick={() => setEditing({ role })}>
                      {locked ? (
                        <>
                          <LockIcon /> Locked
                        </>
                      ) : (
                        "Edit"
                      )}
                    </Button>
                  </div>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      <RoleFormDialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)} role={editing?.role ?? null} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete role ${deleting?.name}?`}
        description="Roles that are still assigned to users can't be deleted."
        confirmLabel="Delete role"
        destructive
        pending={deleteRole.isPending}
        onConfirm={confirmDelete}
      />
    </>
  );
}
