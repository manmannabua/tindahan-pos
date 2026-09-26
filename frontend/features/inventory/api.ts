"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";

import { useBranches } from "@/features/branches/api";
import { api } from "@/lib/api";
import type { BranchDetail, StockLocation } from "@/types/api";
import type {
  Adjustment,
  AdjustmentCreate,
  Balance,
  Movement,
  Paged,
  PostingResult,
  StockCount,
  StockCountLine,
  Transfer,
  TransferCreate,
} from "@/types/api-admin";

export const inventoryKeys = {
  all: ["inventory"] as const,
  balances: (p: object) => [...inventoryKeys.all, "balances", p] as const,
  movements: (p: object) => [...inventoryKeys.all, "movements", p] as const,
  adjustments: (p: object) => [...inventoryKeys.all, "adjustments", p] as const,
  counts: (p: object) => [...inventoryKeys.all, "counts", p] as const,
  count: (id: string) => [...inventoryKeys.all, "count", id] as const,
  transfers: (p: object) => [...inventoryKeys.all, "transfers", p] as const,
  transfer: (id: string) => [...inventoryKeys.all, "transfer", id] as const,
};

export interface LocationOption extends StockLocation {
  branchName: string;
  branchCode: string;
}

/** Every stock location of every visible branch (branch detail requests run in parallel). */
export function useStockLocations(): { data: LocationOption[]; isPending: boolean } {
  const branches = useBranches();
  const details = useQueries({
    queries: (branches.data ?? []).map((b) => ({
      queryKey: ["branches", "detail", b.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<BranchDetail>(`/branches/${b.id}`, undefined, signal),
      staleTime: 60_000,
    })),
  });
  const data = details.flatMap((q) =>
    (q.data?.locations ?? []).map((l) => ({ ...l, branchName: q.data?.name ?? "", branchCode: q.data?.code ?? "" })),
  );
  return { data, isPending: branches.isPending || details.some((q) => q.isPending) };
}

export function useLocationLabels(): Record<string, string> {
  const { data } = useStockLocations();
  return Object.fromEntries(data.map((l) => [l.id, `${l.branchCode} · ${l.name}`]));
}

export interface BalanceParams {
  stock_location_id?: string;
  q?: string;
  low_stock?: boolean;
  negative?: boolean;
  limit: number;
  offset: number;
}

export function useBalances(params: BalanceParams) {
  return useQuery({
    queryKey: inventoryKeys.balances(params),
    queryFn: ({ signal }) => api.get<Paged<Balance>>("/inventory/balances", { ...params }, signal),
    placeholderData: (prev) => prev,
  });
}

export interface MovementParams {
  variant_id?: string;
  stock_location_id?: string;
  movement_type?: string;
  reference_id?: string;
  limit: number;
  offset: number;
}

export function useMovements(params: MovementParams) {
  return useQuery({
    queryKey: inventoryKeys.movements(params),
    queryFn: ({ signal }) => api.get<Paged<Movement>>("/inventory/movements", { ...params }, signal),
    placeholderData: (prev) => prev,
  });
}

function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
}

export function useAdjustments(params: { limit: number; offset: number }) {
  return useQuery({
    queryKey: inventoryKeys.adjustments(params),
    queryFn: ({ signal }) => api.get<Paged<Adjustment>>("/inventory/adjustments", { ...params }, signal),
  });
}

export function useCreateAdjustment() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (data: AdjustmentCreate) => api.post<Adjustment>("/inventory/adjustments", data),
    onSuccess: invalidate,
  });
}

export function usePostInitialStock() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (data: { stock_location_id: string; note: string | null; lines: { variant_id: string; quantity: string; unit_cost: string | null }[] }) =>
      api.post<PostingResult>("/inventory/initial-stock", data),
    onSuccess: invalidate,
  });
}

// --- counts ------------------------------------------------------------------------------------

export function useCounts(params: { status?: string; limit: number; offset: number }) {
  return useQuery({
    queryKey: inventoryKeys.counts(params),
    queryFn: ({ signal }) => api.get<Paged<StockCount>>("/inventory/counts", { ...params }, signal),
  });
}

export function useCount(id: string) {
  return useQuery({
    queryKey: inventoryKeys.count(id),
    queryFn: ({ signal }) => api.get<StockCount>(`/inventory/counts/${id}`, undefined, signal),
  });
}

export function useStartCount() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (data: { stock_location_id: string; is_full: boolean; note: string | null }) =>
      api.post<StockCount>("/inventory/counts", data),
    onSuccess: invalidate,
  });
}

export function recordCountLine(
  countId: string,
  body: { barcode?: string; variant_id?: string; quantity: string; mode: "ADD" | "SET" },
) {
  return api.post<StockCountLine>(`/inventory/counts/${countId}/lines`, body);
}

export function useCountAction(countId: string, action: "complete" | "cancel") {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: () => api.post<StockCount>(`/inventory/counts/${countId}/${action}`),
    onSuccess: invalidate,
  });
}

// --- transfers ---------------------------------------------------------------------------------

export function useTransfers(params: { status?: string; limit: number; offset: number }) {
  return useQuery({
    queryKey: inventoryKeys.transfers(params),
    queryFn: ({ signal }) => api.get<Paged<Transfer>>("/inventory/transfers", { ...params }, signal),
  });
}

export function useTransfer(id: string) {
  return useQuery({
    queryKey: inventoryKeys.transfer(id),
    queryFn: ({ signal }) => api.get<Transfer>(`/inventory/transfers/${id}`, undefined, signal),
  });
}

export function useCreateTransfer() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: (data: TransferCreate) => api.post<Transfer>("/inventory/transfers", data),
    onSuccess: invalidate,
  });
}

export function useTransferAction(id: string) {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ action, lines }: { action: "send" | "receive" | "cancel"; lines?: { line_id: string; received_base_quantity: string }[] }) =>
      api.post<Transfer>(`/inventory/transfers/${id}/${action}`, action === "receive" ? { lines: lines ?? [] } : undefined),
    onSuccess: invalidate,
  });
}

/** variant id → display name for items stocked at a location (from its balances). */
export function useVariantNamesAt(locationId: string | undefined): Record<string, string> {
  const { data } = useBalances({ stock_location_id: locationId, limit: 500, offset: 0 });
  return Object.fromEntries(
    (data?.items ?? []).map((b) => [b.variant_id, `${b.product_name}${b.variant_name ? ` · ${b.variant_name}` : ""}`]),
  );
}
