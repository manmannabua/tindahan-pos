"use client";

import { useShallow } from "zustand/react/shallow";

import { hasPermission, hasPermissionInAnyScope } from "@/lib/auth/permissions";
import { type FeatureKey, isFeatureOn } from "@/lib/features";
import { useAuthStore } from "@/stores/auth-store";

export function useSession() {
  return useAuthStore(useShallow((s) => ({ user: s.user, status: s.status })));
}

/**
 * Mirrors backend `Principal.has(permission, branch_id)`: true if granted company-wide, or for
 * `branchId` when given. UI gating only — the server always re-checks.
 */
export function usePermission(permission: string, branchId?: string | null): boolean {
  return useAuthStore((s) => hasPermission(s.user, permission, branchId));
}

/** Mirrors backend `require_permission`: granted in at least one scope. Use for navigation. */
export function usePermissionInAnyScope(permission: string): boolean {
  return useAuthStore((s) => hasPermissionInAnyScope(s.user, permission));
}

/** Is an optional feature switched on for this business? UI gating only — the server enforces. */
export function useFeature(feature: FeatureKey): boolean {
  return useAuthStore((s) => isFeatureOn(s.user?.company.features, feature));
}
