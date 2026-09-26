"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Paged, SalesReceipt, SalesReceiptSummary } from "@/types/api-admin";

export const receiptKeys = {
  all: ["receipts"] as const,
  list: (p: object) => [...receiptKeys.all, "list", p] as const,
  detail: (id: string) => [...receiptKeys.all, "detail", id] as const,
};

export interface ReceiptListParams {
  q?: string;
  kind?: "SALE" | "RETURN";
  printed?: boolean;
  branch_id?: string;
  sale_id?: string;
  issued_from?: string;
  issued_to?: string;
  limit: number;
  offset: number;
}

/** The receipt journal: every receipt the terminals issued, printed or not. */
export function useReceipts(params: ReceiptListParams, enabled = true) {
  return useQuery({
    queryKey: receiptKeys.list(params),
    queryFn: ({ signal }) => api.get<Paged<SalesReceiptSummary>>("/receipts", { ...params }, signal),
    placeholderData: (prev) => prev,
    enabled,
  });
}

export function useReceipt(id: string | null) {
  return useQuery({
    queryKey: receiptKeys.detail(id ?? ""),
    queryFn: ({ signal }) => api.get<SalesReceipt>(`/receipts/${id}`, undefined, signal),
    enabled: Boolean(id),
  });
}
