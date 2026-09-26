"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { Company, CompanyUpdate } from "@/types/api";
import type { FeaturesView } from "@/types/api-admin";

export const companyKeys = { current: ["company", "current"] as const, features: ["company", "features"] as const };

export function useCompany() {
  return useQuery({
    queryKey: companyKeys.current,
    queryFn: ({ signal }) => api.get<Company>("/companies/current", undefined, signal),
  });
}

export function useUpdateCompany() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CompanyUpdate) => api.patch<Company>("/companies/current", data),
    onSuccess: (company) => {
      queryClient.setQueryData(companyKeys.current, company);
      // Keep the session's company summary (sidebar name, currency) in sync.
      const { user, accessToken, setSession } = useAuthStore.getState();
      if (user && accessToken) {
        setSession(accessToken, {
          ...user,
          company: {
            ...user.company,
            name: company.name,
            timezone: company.timezone,
            prices_include_tax: company.prices_include_tax,
          },
        });
      }
    },
  });
}

/** Patch the signed-in session's company summary so the UI reacts without a reload. */
function patchSessionCompany(patch: Partial<{ features: Record<string, boolean>; onboarding_completed: boolean }>): void {
  const { user, accessToken, setSession } = useAuthStore.getState();
  if (user && accessToken) setSession(accessToken, { ...user, company: { ...user.company, ...patch } });
}

export function useFeatureSettings() {
  return useQuery({
    queryKey: companyKeys.features,
    queryFn: ({ signal }) => api.get<FeaturesView>("/companies/current/features", undefined, signal),
  });
}

export function useSaveFeatures() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (features: Record<string, boolean>) => api.put<FeaturesView>("/companies/current/features", { features }),
    onSuccess: (view) => {
      queryClient.setQueryData(companyKeys.features, view);
      // Report lists, dashboard cards, etc. depend on which features are on.
      void queryClient.invalidateQueries();
      patchSessionCompany({ features: Object.fromEntries(view.features.map((f) => [f.key, f.enabled])) });
    },
  });
}

export function useCompleteOnboarding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<Company>("/companies/current/onboarding/complete"),
    onSuccess: (company) => {
      queryClient.setQueryData(companyKeys.current, company);
      patchSessionCompany({ onboarding_completed: true });
    },
  });
}
