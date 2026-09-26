"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { roundMoney, toBig } from "@/lib/money";
import type { Paged, ReturnCreate, SaleDetail, SaleReturn, SaleSummary } from "@/types/api-admin";

export const saleKeys = {
  all: ["sales"] as const,
  list: (p: object) => [...saleKeys.all, "list", p] as const,
  detail: (id: string) => [...saleKeys.all, "detail", id] as const,
  ret: (id: string) => [...saleKeys.all, "return", id] as const,
};

export interface SaleListParams {
  branch_id?: string;
  receipt_number?: string;
  occurred_from?: string;
  occurred_to?: string;
  limit: number;
  offset: number;
}

export function useSales(params: SaleListParams) {
  return useQuery({
    queryKey: saleKeys.list(params),
    queryFn: ({ signal }) => api.get<Paged<SaleSummary>>("/sales", { ...params }, signal),
    placeholderData: (prev) => prev,
  });
}

export function useSale(id: string) {
  return useQuery({
    queryKey: saleKeys.detail(id),
    queryFn: ({ signal }) => api.get<SaleDetail>(`/sales/${id}`, undefined, signal),
    enabled: Boolean(id),
  });
}

export function useSaleReturn(id: string) {
  return useQuery({
    queryKey: saleKeys.ret(id),
    queryFn: ({ signal }) => api.get<SaleReturn>(`/returns/${id}`, undefined, signal),
  });
}

function useInvalidateSales() {
  const queryClient = useQueryClient();
  return () => Promise.all([queryClient.invalidateQueries({ queryKey: saleKeys.all }), queryClient.invalidateQueries({ queryKey: ["inventory"] })]);
}

export function useVoidSale(id: string) {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: (reason: string) => api.post<SaleDetail>(`/sales/${id}/void`, { reason }),
    onSuccess: invalidate,
  });
}

export function useCreateReturn() {
  const invalidate = useInvalidateSales();
  return useMutation({
    mutationFn: (data: ReturnCreate) => api.post<SaleReturn>("/returns", data),
    onSuccess: invalidate,
  });
}

/**
 * Estimated refund for returning `quantity` of a line: its share of what the customer paid.
 * The server is authoritative (the last units of a line refund the exact remainder); if it
 * disagrees it answers `return.refund_mismatch` with the correct `refund_total`.
 */
export function estimateRefund(lineTotal: string, lineQuantity: string, quantity: string): string {
  if (toBig(lineQuantity).lte("0")) return "0.00";
  return roundMoney(toBig(lineTotal).times(toBig(quantity)).div(toBig(lineQuantity))).toFixed(2);
}
