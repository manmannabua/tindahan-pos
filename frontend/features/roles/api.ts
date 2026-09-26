"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Permission, Role, RoleCreate, RoleUpdate } from "@/types/api";

export const roleKeys = {
  all: ["roles"] as const,
  list: () => [...roleKeys.all, "list"] as const,
  permissions: ["permissions"] as const,
};

export function useRoles() {
  return useQuery({
    queryKey: roleKeys.list(),
    queryFn: ({ signal }) => api.get<Role[]>("/roles", undefined, signal),
  });
}

export function usePermissionCatalog() {
  return useQuery({
    queryKey: roleKeys.permissions,
    queryFn: ({ signal }) => api.get<Permission[]>("/permissions", undefined, signal),
    staleTime: Infinity, // defined in backend code; changes only with a deploy
  });
}

export function useCreateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: RoleCreate) => api.post<Role>("/roles", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roleKeys.all }),
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: RoleUpdate }) => api.patch<Role>(`/roles/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roleKeys.all }),
  });
}

export function useDeleteRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/roles/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: roleKeys.all }),
  });
}

/** Group permission codes by their prefix ("sales.void" → "sales"). */
export function groupPermissions(permissions: Permission[]): Array<[string, Permission[]]> {
  const groups = new Map<string, Permission[]>();
  for (const permission of permissions) {
    const group = permission.code.split(".")[0];
    groups.set(group, [...(groups.get(group) ?? []), permission]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
