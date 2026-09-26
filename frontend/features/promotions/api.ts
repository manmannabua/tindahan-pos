"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Paged, Promotion, PromotionCreate } from "@/types/api-admin";

export const promotionKeys = { all: ["promotions"] as const, list: (p: object) => ["promotions", "list", p] as const };

export function usePromotions(params: { include_inactive?: boolean; limit: number; offset: number }) {
  return useQuery({
    queryKey: promotionKeys.list(params),
    queryFn: ({ signal }) => api.get<Paged<Promotion>>("/promotions", { ...params }, signal),
  });
}

/** Promotions are edited and synced as a unit: updates are full replacements (PUT). */
export function useSavePromotion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id?: string; data: PromotionCreate }) =>
      id ? api.put<Promotion>(`/promotions/${id}`, data) : api.post<Promotion>("/promotions", data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: promotionKeys.all }),
  });
}

export const PROMOTION_KINDS = [
  { value: "PERCENT_OFF", label: "Percent off" },
  { value: "AMOUNT_OFF", label: "Amount off per unit" },
  { value: "FIXED_PRICE", label: "Fixed unit price" },
  { value: "BUY_X_GET_Y", label: "Buy X get Y free" },
] as const;

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Human summary, e.g. "10% off", "Buy 2 get 1". */
export function describePromotion(p: Pick<Promotion, "kind" | "value" | "buy_quantity" | "get_quantity">): string {
  const n = (v: string | null) => (v === null ? "?" : String(Number(v)));
  switch (p.kind) {
    case "PERCENT_OFF":
      return `${n(p.value)}% off`;
    case "AMOUNT_OFF":
      return `₱${p.value} off each`;
    case "FIXED_PRICE":
      return `₱${p.value} each`;
    case "BUY_X_GET_Y":
      return `Buy ${n(p.buy_quantity)} get ${n(p.get_quantity)}`;
  }
}

/** "Sat–Sun 16:00–19:00", "Every day". */
export function describeSchedule(p: Pick<Promotion, "days_of_week" | "start_time" | "end_time">): string {
  const days = p.days_of_week?.length ? p.days_of_week.map((d) => WEEKDAYS[d - 1]).join(", ") : "Every day";
  const time = p.start_time && p.end_time ? ` ${p.start_time.slice(0, 5)}–${p.end_time.slice(0, 5)}` : "";
  return `${days}${time}`;
}
