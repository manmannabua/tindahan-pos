"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { API_PREFIX, CLIENT_HEADER } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { refreshAccessToken } from "@/lib/auth/session";
import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { ImportJob } from "@/types/api-admin";

export const IMPORT_COLUMNS = [
  "name",
  "sku",
  "barcode",
  "category",
  "brand",
  "unit",
  "price",
  "cost",
  "tax",
  "track_inventory",
  "reorder_point",
  "opening_stock",
] as const;

export const TEMPLATE_CSV =
  `${IMPORT_COLUMNS.join(",")}\n` +
  "Coke 1.5L,COKE15,4800361419116,Drinks,Coca-Cola,PC,75.00,60,VAT12,yes,10,24\n" +
  "Rice 1kg,RICE1,,Grocery,,KG,52.50,45,VAT_EXEMPT,yes,20,100.5\n";

/** Multipart upload (the JSON api client can't send FormData). */
async function upload(file: File, stockLocationId: string | null): Promise<ImportJob> {
  const form = new FormData();
  form.append("file", file);
  const query = stockLocationId ? `?stock_location_id=${encodeURIComponent(stockLocationId)}` : "";
  const send = (token: string | null) =>
    fetch(`${API_PREFIX}/imports/products${query}`, {
      method: "POST",
      body: form,
      headers: { ...CLIENT_HEADER, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: "same-origin",
    });
  let response = await send(useAuthStore.getState().accessToken);
  if (response.status === 401) {
    const token = await refreshAccessToken("admin");
    if (token) response = await send(token);
  }
  if (!response.ok) throw await ApiError.fromResponse(response);
  return (await response.json()) as ImportJob;
}

export function useUploadImport() {
  return useMutation({
    mutationFn: ({ file, stockLocationId }: { file: File; stockLocationId: string | null }) => upload(file, stockLocationId),
  });
}

/** Polls every second until the job is DONE or FAILED. */
export function useImportJob(id: string | null) {
  return useQuery({
    queryKey: ["imports", id],
    queryFn: ({ signal }) => api.get<ImportJob>(`/imports/${id}`, undefined, signal),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "DONE" || status === "FAILED" ? false : 1000;
    },
  });
}

export interface ImportResult {
  rows: number;
  created: number;
  updated: number;
  opening_stock_lines: number;
  error_count: number;
  errors: { row: number; errors: string[] }[];
}

export function parseResult(job: ImportJob | undefined): ImportResult | null {
  const r = job?.result as Partial<ImportResult> | null | undefined;
  if (!r) return null;
  return {
    rows: r.rows ?? 0,
    created: r.created ?? 0,
    updated: r.updated ?? 0,
    opening_stock_lines: r.opening_stock_lines ?? 0,
    error_count: r.error_count ?? 0,
    errors: Array.isArray(r.errors) ? r.errors : [],
  };
}
