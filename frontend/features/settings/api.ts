"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/stores/auth-store";
import type { Company, CompanyUpdate } from "@/types/api";

export const companyKeys = { current: ["company", "current"] as const };

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
