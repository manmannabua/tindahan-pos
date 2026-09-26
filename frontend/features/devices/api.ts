"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { Device, DeviceUpdate } from "@/types/api";

export const deviceKeys = {
  all: ["devices"] as const,
  list: (branchId: string | null) => [...deviceKeys.all, "list", { branchId }] as const,
};

export function useDevices(branchId: string | null) {
  return useQuery({
    queryKey: deviceKeys.list(branchId),
    queryFn: ({ signal }) => api.get<Device[]>("/devices", { branch_id: branchId }, signal),
    refetchInterval: 60_000, // last-seen / sync columns change while the page is open
  });
}

export function useRevokeDevice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<Device>(`/devices/${id}/revoke`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: deviceKeys.all }),
  });
}

export function useUpdateDevice(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DeviceUpdate) => api.patch<Device>(`/devices/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: deviceKeys.all }),
  });
}
