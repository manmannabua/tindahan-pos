"use client";

import { useEffect } from "react";

import { restoreSession } from "@/lib/auth/session";
import { type AuthStatus, useAuthStore } from "@/stores/auth-store";

/**
 * The access token lives only in memory, so a page load starts signed out. This restores the
 * session from the httpOnly refresh cookie (single-flight, safe under StrictMode double effects).
 */
export function useRestoreSession(): AuthStatus {
  const status = useAuthStore((s) => s.status);
  useEffect(() => {
    void restoreSession();
  }, []);
  return status;
}
