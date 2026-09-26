"use client";

import { PlusIcon, SearchIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { QueryError, TableSkeleton } from "@/components/shared/query-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSession } from "@/features/auth/hooks";
import { useUpdateUser, useUsers } from "@/features/users/api";
import { ResetPasswordDialog, SetPinDialog } from "@/features/users/components/credential-dialogs";
import { UserCreateDialog } from "@/features/users/components/user-create-dialog";
import { UserEditDialog } from "@/features/users/components/user-edit-dialog";
import { type UserAction, UsersTable } from "@/features/users/components/users-table";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { errorMessage } from "@/lib/api/errors";
import type { User } from "@/types/api";

const PAGE_SIZE = 25;

export default function UsersPage() {
  const { user: me } = useSession();
  const [search, setSearch] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [offset, setOffset] = useState(0);
  const q = useDebouncedValue(search.trim());
  const { data, isPending, error, refetch, isPlaceholderData } = useUsers({ q, includeInactive, limit: PAGE_SIZE, offset });

  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<{ action: UserAction; user: User } | null>(null);
  const updateUser = useUpdateUser();

  const close = () => setDialog(null);
  const toggleActive = (user: User) =>
    updateUser.mutate(
      { id: user.id, data: { is_active: !user.is_active } },
      {
        onSuccess: () => {
          toast.success(`${user.full_name} ${user.is_active ? "deactivated" : "activated"}`);
          close();
        },
        onError: (e) => toast.error(errorMessage(e)),
      },
    );

  return (
    <>
      <PageHeader
        title="Users"
        description="Staff accounts, their roles and POS PINs."
        actions={
          <Button onClick={() => setCreating(true)}>
            <PlusIcon /> New user
          </Button>
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-80">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name, email or username"
            className="h-10 pl-8"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
            aria-label="Search users"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="inactive-users"
            checked={includeInactive}
            onCheckedChange={(v) => {
              setIncludeInactive(v);
              setOffset(0);
            }}
          />
          <Label htmlFor="inactive-users">Show inactive</Label>
        </div>
      </div>

      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <QueryError error={error} onRetry={() => void refetch()} />
      ) : data.items.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No users found" description={q ? "Try a different search." : undefined} />
      ) : (
        <div className={isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
          <UsersTable users={data.items} currentUserId={me?.id} onAction={(action, user) => setDialog({ action, user })} />
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {offset + 1}–{offset + data.items.length} of {data.total}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

      <UserCreateDialog open={creating} onOpenChange={setCreating} />
      <UserEditDialog
        user={dialog?.action === "edit" ? dialog.user : null}
        isSelf={dialog?.user.id === me?.id}
        onOpenChange={(open) => !open && close()}
      />
      <SetPinDialog user={dialog?.action === "pin" ? dialog.user : null} onOpenChange={(open) => !open && close()} />
      <ResetPasswordDialog
        user={dialog?.action === "password" ? dialog.user : null}
        onOpenChange={(open) => !open && close()}
      />
      <ConfirmDialog
        open={dialog?.action === "toggle-active"}
        onOpenChange={(open) => !open && close()}
        title={dialog?.user.is_active ? `Deactivate ${dialog.user.full_name}?` : `Activate ${dialog?.user.full_name}?`}
        description={
          dialog?.user.is_active
            ? "They will be signed out everywhere and can no longer sign in to the portal or POS terminals."
            : "They will be able to sign in again with their existing credentials."
        }
        confirmLabel={dialog?.user.is_active ? "Deactivate" : "Activate"}
        destructive={dialog?.user.is_active}
        pending={updateUser.isPending}
        onConfirm={() => dialog && toggleActive(dialog.user)}
      />
    </>
  );
}
