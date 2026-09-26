"use client";

import { KeyRoundIcon, MoreHorizontalIcon } from "lucide-react";

import { ActiveBadge } from "@/components/shared/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useBranchLabels } from "@/features/branches/api";
import { formatDateTime } from "@/lib/format";
import type { User } from "@/types/api";

export type UserAction = "edit" | "pin" | "password" | "toggle-active";

interface UsersTableProps {
  users: User[];
  currentUserId: string | undefined;
  onAction: (action: UserAction, user: User) => void;
}

export function UsersTable({ users, currentUserId, onAction }: UsersTableProps) {
  const branchLabels = useBranchLabels();
  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead className="hidden md:table-cell">Roles</TableHead>
            <TableHead className="hidden lg:table-cell">Last sign-in</TableHead>
            <TableHead className="w-28">Status</TableHead>
            <TableHead className="w-12" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id} className="h-14">
              <TableCell>
                <div className="font-medium">
                  {user.full_name}
                  {user.id === currentUserId && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  @{user.username} · {user.email}
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <div className="flex flex-wrap gap-1">
                  {user.roles.map((role) => (
                    <Badge key={`${role.role_id}-${role.branch_id}`} variant="secondary">
                      {role.role_name}
                      {role.branch_id && (
                        <span className="text-muted-foreground">
                          {" "}@ {branchLabels[role.branch_id]?.split(" · ")[0] ?? "branch"}
                        </span>
                      )}
                    </Badge>
                  ))}
                  {user.has_pin && (
                    <Badge variant="outline" title="Has a POS PIN">
                      <KeyRoundIcon className="size-3" /> PIN
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                {formatDateTime(user.last_login_at)}
              </TableCell>
              <TableCell>
                <ActiveBadge active={user.is_active} />
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Actions for ${user.full_name}`} />}>
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onAction("edit", user)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onAction("pin", user)}>Set POS PIN</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onAction("password", user)}>Reset password</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant={user.is_active ? "destructive" : "default"}
                      disabled={user.id === currentUserId}
                      onClick={() => onAction("toggle-active", user)}
                    >
                      {user.is_active ? "Deactivate" : "Activate"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
