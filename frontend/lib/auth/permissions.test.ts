import { describe, expect, it } from "vitest";

import type { Me } from "@/types/api";

import { branchScope, hasPermission, hasPermissionInAnyScope } from "./permissions";

const BRANCH_A = "a";
const BRANCH_B = "b";

function user(permissions: string[], branch_permissions: Record<string, string[]> = {}): Me {
  return {
    id: "u",
    email: "u@example.com",
    username: "u",
    full_name: "U",
    has_pin: false,
    company: { id: "c", code: "C", name: "C", currency: "PHP", timezone: "Asia/Manila", prices_include_tax: true, features: {}, onboarding_completed: true },
    device_id: null,
    permissions,
    branch_permissions,
  };
}

describe("permission checks (mirror backend Principal)", () => {
  it("global permission applies everywhere", () => {
    const u = user(["sales.void"]);
    expect(hasPermission(u, "sales.void")).toBe(true);
    expect(hasPermission(u, "sales.void", BRANCH_A)).toBe(true);
    expect(branchScope(u, "sales.void")).toBeNull();
  });

  it("branch permission applies only to that branch", () => {
    const u = user([], { [BRANCH_A]: ["sales.void"] });
    expect(hasPermission(u, "sales.void", BRANCH_A)).toBe(true);
    expect(hasPermission(u, "sales.void", BRANCH_B)).toBe(false);
    expect(hasPermission(u, "sales.void")).toBe(false);
    expect(hasPermissionInAnyScope(u, "sales.void")).toBe(true);
    expect(branchScope(u, "sales.void")).toEqual([BRANCH_A]);
  });

  it("no user means no permissions", () => {
    expect(hasPermission(null, "x")).toBe(false);
    expect(hasPermissionInAnyScope(null, "x")).toBe(false);
    expect(branchScope(null, "x")).toEqual([]);
  });
});
