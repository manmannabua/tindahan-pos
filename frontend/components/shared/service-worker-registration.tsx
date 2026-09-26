"use client";

import { SerwistProvider } from "@serwist/turbopack/react";
import type { ReactNode } from "react";

/**
 * Registers the service worker in production builds only (a dev SW caching hot-reloaded chunks
 * causes confusing stale code).
 *
 * `reloadOnOnline` is off: reloading the page when connectivity returns would interrupt a sale.
 * `cacheOnNavigation` is off: only the explicitly precached shell (incl. /pos) is cached; admin
 * pages are online-only by design.
 */
export function ServiceWorkerRegistration({ children }: { children: ReactNode }) {
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV !== "production"}
      reloadOnOnline={false}
      cacheOnNavigation={false}
      options={{ scope: "/" }}
    >
      {children}
    </SerwistProvider>
  );
}
