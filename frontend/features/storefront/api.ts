"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { catalogKeys } from "@/features/catalog/api";
import { api } from "@/lib/api";
import type { ProductsOnlineUpdate, Storefront, StorefrontUpdate } from "@/types/api-admin";

export const storefrontKeys = { settings: ["storefront"] as const };

export function useStorefront() {
  return useQuery({
    queryKey: storefrontKeys.settings,
    queryFn: ({ signal }) => api.get<Storefront>("/storefront", undefined, signal),
  });
}

export function useSaveStorefront() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: StorefrontUpdate) => api.put<Storefront>("/storefront", data),
    onSuccess: (saved) => queryClient.setQueryData(storefrontKeys.settings, saved),
  });
}

/** Show/hide products online: explicit ids, or everything matching the product list filter. */
export function useSetProductsOnline() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ProductsOnlineUpdate) => api.post<{ updated: number }>("/products/show-online", data),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: catalogKeys.products }),
        queryClient.invalidateQueries({ queryKey: storefrontKeys.settings }),
      ]),
  });
}

/** Public address of a store's catalog (absolute when running in the browser). */
export function storefrontUrl(slug: string): string {
  const path = `/s/${slug}`;
  return typeof window === "undefined" ? path : `${window.location.origin}${path}`;
}
