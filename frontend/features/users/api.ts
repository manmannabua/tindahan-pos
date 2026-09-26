"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Page, RoleAssignment, User, UserCreate, UserUpdate } from "@/types/api";

export interface UserListParams {
  q: string;
  includeInactive: boolean;
  limit: number;
  offset: number;
}

export const userKeys = {
  all: ["users"] as const,
  list: (params: UserListParams) => [...userKeys.all, "list", params] as const,
};

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: ({ signal }) =>
      api.get<Page<User>>(
        "/users",
        { q: params.q, include_inactive: params.includeInactive, limit: params.limit, offset: params.offset },
        signal,
      ),
    placeholderData: keepPreviousData,
  });
}

function useUserMutation<TVariables, TResult>(fn: (variables: TVariables) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export const useCreateUser = () => useUserMutation((data: UserCreate) => api.post<User>("/users", data));

export const useUpdateUser = () =>
  useUserMutation(({ id, data }: { id: string; data: UserUpdate }) => api.patch<User>(`/users/${id}`, data));

export const useSetUserRoles = () =>
  useUserMutation(({ id, roles }: { id: string; roles: RoleAssignment[] }) =>
    api.put<User>(`/users/${id}/roles`, { roles }),
  );

export const useSetUserPin = () =>
  useUserMutation(({ id, pin }: { id: string; pin: string }) => api.put<void>(`/users/${id}/pin`, { pin }));

export const useResetUserPassword = () =>
  useUserMutation(({ id, password }: { id: string; password: string }) =>
    api.put<void>(`/users/${id}/password`, { password }),
  );
