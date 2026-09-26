"use client";

import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Dashboard, ReportExport, ReportInfo, ReportResult } from "@/types/api-admin";

export interface ReportParams {
  date_from?: string;
  date_to?: string;
  branch_id?: string;
  granularity?: "day" | "week" | "month";
  limit?: number;
  /** Terminal for the terminal-reading report. */
  device_id?: string;
}

export const reportKeys = {
  catalogue: ["reports", "catalogue"] as const,
  run: (name: string, params: ReportParams) => ["reports", "run", name, params] as const,
  export: (id: string) => ["reports", "export", id] as const,
  dashboard: (branchId?: string) => ["dashboard", branchId ?? "all"] as const,
};

export function useReportCatalogue() {
  return useQuery({
    queryKey: reportKeys.catalogue,
    queryFn: ({ signal }) => api.get<ReportInfo[]>("/reports", undefined, signal),
    staleTime: 5 * 60_000,
  });
}

export function useReport(name: string, params: ReportParams, enabled = true) {
  return useQuery({
    queryKey: reportKeys.run(name, params),
    queryFn: ({ signal }) => api.get<ReportResult>(`/reports/${name}`, { ...params }, signal),
    placeholderData: (prev) => prev,
    enabled,
  });
}

export function useStartExport(name: string) {
  return useMutation({
    mutationFn: (params: ReportParams) => api.request<ReportExport>(`/reports/${name}/export`, { method: "POST", query: { ...params } }),
  });
}

/** Polls until the export is DONE or FAILED. */
export function useExportStatus(id: string | null) {
  return useQuery({
    queryKey: reportKeys.export(id ?? ""),
    queryFn: ({ signal }) => api.get<ReportExport>(`/reports/exports/${id}`, undefined, signal),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.status === "DONE" || q.state.data?.status === "FAILED" ? false : 1000),
  });
}

export function useDashboard(branchId?: string) {
  return useQuery({
    queryKey: reportKeys.dashboard(branchId),
    queryFn: ({ signal }) => api.get<Dashboard>("/dashboard", { branch_id: branchId }, signal),
    // Realtime invalidates this on every sync; the interval is the fallback without WebSockets.
    refetchInterval: 60_000,
  });
}

/** Reports whose rows are a time series worth charting: [x column, y column]. */
export const CHARTS: Record<string, [string, string]> = {
  "sales-trend": ["period", "sales"],
  "sales-by-hour": ["hour", "sales"],
};

/** Reports that need a terminal picked before they can run or be exported. */
export const NEEDS_DEVICE = new Set(["terminal-reading"]);

/** Reports that ignore the date range (current state). */
export const POINT_IN_TIME = new Set(["inventory-valuation", "low-stock", "out-of-stock", "negative-inventory"]);
