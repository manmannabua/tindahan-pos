import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useAuthStore } from "@/stores/auth-store";
import type { Me } from "@/types/api";

import { usePermission, usePermissionInAnyScope, useSession } from "./hooks";

const me: Me = {
  id: "u1",
  email: "m@example.com",
  username: "m",
  full_name: "Manager",
  has_pin: true,
  company: { id: "c", code: "ACME", name: "Acme", currency: "PHP", timezone: "Asia/Manila", prices_include_tax: true, features: {}, onboarding_completed: true },
  device_id: null,
  permissions: ["products.read"],
  branch_permissions: { "branch-a": ["branches.manage"] },
};

beforeEach(() => {
  useAuthStore.getState().clearSession();
});

describe("auth hooks", () => {
  it("reflects session changes", () => {
    const { result } = renderHook(() => useSession());
    expect(result.current.status).toBe("anonymous");
    act(() => useAuthStore.getState().setSession("token", me));
    expect(result.current.status).toBe("authenticated");
    expect(result.current.user?.username).toBe("m");
  });

  it("usePermission follows Principal.has semantics", () => {
    act(() => useAuthStore.getState().setSession("token", me));
    expect(renderHook(() => usePermission("products.read")).result.current).toBe(true);
    expect(renderHook(() => usePermission("branches.manage")).result.current).toBe(false);
    expect(renderHook(() => usePermission("branches.manage", "branch-a")).result.current).toBe(true);
    expect(renderHook(() => usePermission("branches.manage", "branch-b")).result.current).toBe(false);
    expect(renderHook(() => usePermissionInAnyScope("branches.manage")).result.current).toBe(true);
  });

  it("denies everything when signed out", () => {
    expect(renderHook(() => usePermissionInAnyScope("products.read")).result.current).toBe(false);
  });
});
