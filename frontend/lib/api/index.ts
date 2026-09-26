import { refreshAccessToken } from "@/lib/auth/session";
import { useAuthStore } from "@/stores/auth-store";

import { createApiClient } from "./client";

export { ApiError, NetworkError, errorMessage } from "./errors";

/** The admin-portal API client: in-memory access token, refresh via the `rt_admin` cookie. */
export const api = createApiClient({
  getAccessToken: () => useAuthStore.getState().accessToken,
  refreshAccessToken: () => refreshAccessToken("admin"),
  onUnauthenticated: () => {
    useAuthStore.getState().clearSession();
    if (typeof window !== "undefined" && !window.location.pathname.startsWith("/login")) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      // Deliberately a full page load (not router.push): this runs outside React, and a hard
      // navigation also discards every in-memory trace of the expired session.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign(`/login?next=${next}`);
    }
  },
});
