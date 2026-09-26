"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Customer, CustomerCreate, CustomerUpdate, Paged } from "@/types/api-admin";

export const customerKeys = {
  all: ["customers"] as const,
  list: (p: object) => [...customerKeys.all, "list", p] as const,
};

export function useCustomers(params: { q?: string; include_inactive?: boolean; limit: number; offset: number }) {
  return useQuery({
    queryKey: customerKeys.list(params),
    queryFn: ({ signal }) => api.get<Paged<Customer>>("/customers", { ...params }, signal),
    placeholderData: (prev) => prev,
  });
}

export function useSaveCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: CustomerCreate | CustomerUpdate }) =>
      id ? api.patch<Customer>(`/customers/${id}`, data) : api.post<Customer>("/customers", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: customerKeys.all }),
  });
}
