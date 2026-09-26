import type { Me } from "@/types/api";

/**
 * Mirrors backend `Principal.has`: granted company-wide, or for `branchId` when given.
 * UI-only convenience — the server enforces every permission independently.
 */
export function hasPermission(user: Me | null, permission: string, branchId?: string | null): boolean {
  if (!user) return false;
  if (user.permissions.includes(permission)) return true;
  if (branchId) return user.branch_permissions[branchId]?.includes(permission) ?? false;
  return false;
}

/** Mirrors backend `Principal.has_in_any_scope`: granted globally or for at least one branch. */
export function hasPermissionInAnyScope(user: Me | null, permission: string): boolean {
  if (!user) return false;
  if (user.permissions.includes(permission)) return true;
  return Object.values(user.branch_permissions).some((perms) => perms.includes(permission));
}

/** Branches where `permission` applies; `null` means all branches. */
export function branchScope(user: Me | null, permission: string): string[] | null {
  if (!user) return [];
  if (user.permissions.includes(permission)) return null;
  return Object.entries(user.branch_permissions)
    .filter(([, perms]) => perms.includes(permission))
    .map(([branchId]) => branchId);
}

/** Permission codes used by the UI (subset of backend `P`). */
export const PERM = {
  POS_ACCESS: "pos.access",
  BRANCHES_MANAGE: "branches.manage",
  USERS_MANAGE: "users.manage",
  ROLES_MANAGE: "roles.manage",
  DEVICES_MANAGE: "devices.manage",
  DEVICES_REGISTER: "devices.register",
  AUDIT_VIEW: "audit.view",
  COMPANY_MANAGE: "company.manage",
} as const;
