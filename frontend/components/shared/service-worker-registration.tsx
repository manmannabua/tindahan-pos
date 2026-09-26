"use client";

import { SerwistProvider } from "@serwist/turbopack/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Registers the service worker in production builds only (a dev SW caching hot-reloaded chunks
 * causes confusing stale code).
 *
 * `reloadOnOnline` is off: reloading the page when connectivity returns would interrupt a sale.
 * `cacheOnNavigation` is off: only the explicitly precached shell (incl. /pos) is cached; admin
 * pages are online-only by design.
 *
 * Not registered on public store catalogs (`/s/...`): shoppers must not download the POS app.
 */
export function ServiceWorkerRegistration({ children }: { children: ReactNode }) {
  const isPublicCatalog = usePathname().startsWith("/s/");
  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      disable={process.env.NODE_ENV !== "production" || isPublicCatalog}
      reloadOnOnline={false}
      cacheOnNavigation={false}
      options={{ scope: "/" }}
    >
      {children}
    </SerwistProvider>
  );
}
