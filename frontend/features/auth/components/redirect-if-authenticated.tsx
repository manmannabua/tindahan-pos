"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useRestoreSession } from "../use-restore-session";

/** Auth pages: a visitor who is already signed in (valid refresh cookie) goes to the app. */
export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  const status = useRestoreSession();
  const router = useRouter();
  useEffect(() => {
    if (status === "authenticated") router.replace("/dashboard");
  }, [status, router]);
  return children;
}
