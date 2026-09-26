"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Expense, ExpenseCategory, ExpenseCreate, Paged, ReviewFlag, SyncMonitor } from "@/types/api-admin";

export const managementKeys = {
  expenses: (p: object) => ["expenses", p] as const,
  expenseCategories: ["expense-categories"] as const,
  flags: (p: object) => ["review-flags", p] as const,
  syncMonitor: ["sync-monitor"] as const,
};

export function useExpenseCategories() {
  return useQuery({
    queryKey: managementKeys.expenseCategories,
    queryFn: ({ signal }) => api.get<ExpenseCategory[]>("/expense-categories", undefined, signal),
  });
}

export function useCreateExpenseCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post<ExpenseCategory>("/expense-categories", { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: managementKeys.expenseCategories }),
  });
}

export function useExpenses(params: { branch_id?: string; category_id?: string; date_from?: string; date_to?: string; limit: number; offset: number }) {
  return useQuery({
    queryKey: managementKeys.expenses(params),
    queryFn: ({ signal }) => api.get<Paged<Expense>>("/expenses", { ...params }, signal),
    placeholderData: (prev) => prev,
  });
}

export function useRecordExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ExpenseCreate) => api.post<Expense>("/expenses", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
}

export function useVoidExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Expense>(`/expenses/${id}/void`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["expenses"] }),
  });
}

export function useReviewFlags(params: { status?: string; flag_type?: string; limit: number; offset: number }) {
  return useQuery({
    queryKey: managementKeys.flags(params),
    queryFn: ({ signal }) => api.get<Paged<ReviewFlag>>("/review-flags", { ...params }, signal),
    placeholderData: (prev) => prev,
  });
}

export function useResolveFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: "RESOLVED" | "DISMISSED"; note: string | null }) =>
      api.post<ReviewFlag>(`/review-flags/${id}/resolve`, { status, note }),
    onSuccess: () => Promise.all([queryClient.invalidateQueries({ queryKey: ["review-flags"] }), queryClient.invalidateQueries({ queryKey: ["dashboard"] })]),
  });
}

export function useSyncMonitor() {
  return useQuery({
    queryKey: managementKeys.syncMonitor,
    queryFn: ({ signal }) => api.get<SyncMonitor>("/sync/monitor", undefined, signal),
    refetchInterval: 30_000,
  });
}

/** Where a flag's subject lives in the admin portal. */
export function flagEntityHref(flag: Pick<ReviewFlag, "entity_type" | "entity_id">): string | null {
  switch (flag.entity_type) {
    case "sale":
      return `/sales/${flag.entity_id}`;
    case "return":
      return `/sales/returns/${flag.entity_id}`;
    case "stock_transfer":
      return `/inventory/transfers/${flag.entity_id}`;
    case "device":
      return "/sync-monitor";
    case "customer":
      return "/customers";
    case "product_variant":
      return "/inventory";
    default:
      return null;
  }
}
