"use client";

import { useInfiniteQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { AuditLogPage } from "@/types/api";

export interface AuditFilters {
  action: string;
  entityType: string;
}

export const auditKeys = {
  all: ["audit-logs"] as const,
  list: (filters: AuditFilters) => [...auditKeys.all, filters] as const,
};

/** Newest first; keyset pagination via `next_cursor` (stable on a table that only grows). */
export function useAuditLogs(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: auditKeys.list(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      api.get<AuditLogPage>(
        "/audit-logs",
        { action: filters.action, entity_type: filters.entityType, cursor: pageParam, limit: 50 },
        signal,
      ),
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  });
}
