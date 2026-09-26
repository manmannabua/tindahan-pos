"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type {
  Branch,
  BranchCreate,
  BranchDetail,
  BranchUpdate,
  StockLocation,
  StockLocationCreate,
  StockLocationUpdate,
} from "@/types/api";

export const branchKeys = {
  all: ["branches"] as const,
  list: (includeInactive: boolean) => [...branchKeys.all, "list", { includeInactive }] as const,
  detail: (id: string) => [...branchKeys.all, "detail", id] as const,
};

export function useBranches(includeInactive = false) {
  return useQuery({
    queryKey: branchKeys.list(includeInactive),
    queryFn: ({ signal }) => api.get<Branch[]>("/branches", { include_inactive: includeInactive }, signal),
  });
}

export function useBranch(id: string) {
  return useQuery({
    queryKey: branchKeys.detail(id),
    queryFn: ({ signal }) => api.get<BranchDetail>(`/branches/${id}`, undefined, signal),
  });
}

/** id → "CODE · Name" for labelling branch ids elsewhere (users, devices, audit). */
export function useBranchLabels(): Record<string, string> {
  const { data } = useBranches(true);
  return Object.fromEntries((data ?? []).map((b) => [b.id, `${b.code} · ${b.name}`]));
}

export function useCreateBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: BranchCreate) => api.post<BranchDetail>("/branches", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: branchKeys.all }),
  });
}

export function useUpdateBranch(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: BranchUpdate) => api.patch<BranchDetail>(`/branches/${id}`, data),
    onSuccess: (branch) => {
      queryClient.setQueryData(branchKeys.detail(id), branch);
      return queryClient.invalidateQueries({ queryKey: branchKeys.all });
    },
  });
}

export function useCreateLocation(branchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: StockLocationCreate) => api.post<StockLocation>(`/branches/${branchId}/locations`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: branchKeys.detail(branchId) }),
  });
}

export function useUpdateLocation(branchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: StockLocationUpdate }) =>
      api.patch<StockLocation>(`/stock-locations/${id}`, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: branchKeys.detail(branchId) }),
  });
}
