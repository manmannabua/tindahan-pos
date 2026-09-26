"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { inventoryKeys } from "@/features/inventory/api";
import { api } from "@/lib/api";
import type {
  GoodsReceipt,
  Paged,
  POCreate,
  PurchaseOrder,
  ReceiptCreate,
  Supplier,
  SupplierCreate,
  SupplierUpdate,
} from "@/types/api-admin";

export const purchasingKeys = {
  all: ["purchasing"] as const,
  suppliers: (p: object) => [...purchasingKeys.all, "suppliers", p] as const,
  pos: (p: object) => [...purchasingKeys.all, "pos", p] as const,
  po: (id: string) => [...purchasingKeys.all, "po", id] as const,
  receipts: (p: object) => [...purchasingKeys.all, "receipts", p] as const,
  receipt: (id: string) => [...purchasingKeys.all, "receipt", id] as const,
};

export function useSuppliers(params: { q?: string; include_inactive?: boolean; limit: number; offset: number }) {
  return useQuery({
    queryKey: purchasingKeys.suppliers(params),
    queryFn: ({ signal }) => api.get<Paged<Supplier>>("/suppliers", { ...params }, signal),
    placeholderData: (prev) => prev,
  });
}

export function useSupplierLabels(): Record<string, string> {
  const { data } = useSuppliers({ include_inactive: true, limit: 200, offset: 0 });
  return Object.fromEntries((data?.items ?? []).map((s) => [s.id, s.name]));
}

export function useSaveSupplier() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: SupplierCreate | SupplierUpdate }) =>
      id ? api.patch<Supplier>(`/suppliers/${id}`, data) : api.post<Supplier>("/suppliers", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...purchasingKeys.all, "suppliers"] }),
  });
}

export function usePurchaseOrders(params: { status?: string; supplier_id?: string; limit: number; offset: number }) {
  return useQuery({
    queryKey: purchasingKeys.pos(params),
    queryFn: ({ signal }) => api.get<Paged<PurchaseOrder>>("/purchase-orders", { ...params }, signal),
    placeholderData: (prev) => prev,
  });
}

export function usePurchaseOrder(id: string) {
  return useQuery({
    queryKey: purchasingKeys.po(id),
    queryFn: ({ signal }) => api.get<PurchaseOrder>(`/purchase-orders/${id}`, undefined, signal),
  });
}

function useInvalidatePurchasing() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: purchasingKeys.all }),
      queryClient.invalidateQueries({ queryKey: inventoryKeys.all }),
      queryClient.invalidateQueries({ queryKey: ["products"] }),
    ]);
}

export function useCreatePurchaseOrder() {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: (data: POCreate) => api.post<PurchaseOrder>("/purchase-orders", data),
    onSuccess: invalidate,
  });
}

export function usePurchaseOrderAction(id: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: (action: "approve" | "cancel" | "close") => api.post<PurchaseOrder>(`/purchase-orders/${id}/${action}`),
    onSuccess: invalidate,
  });
}

export function useReceipts(params: { supplier_id?: string; purchase_order_id?: string; limit: number; offset: number }) {
  return useQuery({
    queryKey: purchasingKeys.receipts(params),
    queryFn: ({ signal }) => api.get<Paged<GoodsReceipt>>("/goods-receipts", { ...params }, signal),
  });
}

export function useReceipt(id: string) {
  return useQuery({
    queryKey: purchasingKeys.receipt(id),
    queryFn: ({ signal }) => api.get<GoodsReceipt>(`/goods-receipts/${id}`, undefined, signal),
  });
}

export function useReceiveGoods() {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: (data: ReceiptCreate) => api.post<GoodsReceipt>("/goods-receipts", data),
    onSuccess: invalidate,
  });
}
