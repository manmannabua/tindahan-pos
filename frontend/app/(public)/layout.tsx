import type { ReactNode } from "react";

/**
 * Public, anonymous pages (online store catalogs). No admin shell, no login, and the POS service
 * worker is not registered here (see ServiceWorkerRegistration).
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
