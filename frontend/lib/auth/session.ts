import { API_PREFIX, CLIENT_HEADER } from "@/lib/api/client";
import { useAuthStore } from "@/stores/auth-store";
import type { AuthClient, TokenResponse } from "@/types/api";

const inflight = new Map<AuthClient, Promise<string | null>>();

/**
 * Exchange the httpOnly refresh cookie for a new access token.
 *
 * Single-flight per client: refresh tokens rotate on every use, and presenting the same token
 * twice looks like theft to the server (it revokes the session). React StrictMode, multiple
 * queries and the session bootstrap can all ask at once — they share one request.
 *
 * Uses raw fetch (not the api client) because the client itself calls this on 401.
 * Returns the new access token, or null if there is no valid session.
 */
export function refreshAccessToken(client: AuthClient = "admin"): Promise<string | null> {
  let promise = inflight.get(client);
  if (!promise) {
    promise = doRefresh(client).finally(() => inflight.delete(client));
    inflight.set(client, promise);
  }
  return promise;
}

async function doRefresh(client: AuthClient): Promise<string | null> {
  let response: Response;
  try {
    response = await fetch(`${API_PREFIX}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...CLIENT_HEADER },
      body: JSON.stringify({ client }),
      credentials: "same-origin",
    });
  } catch {
    // Server unreachable: we can't tell whether the session is valid.
    return null;
  }
  if (!response.ok) {
    useAuthStore.getState().clearSession();
    return null;
  }
  const data = (await response.json()) as TokenResponse;
  useAuthStore.getState().setSession(data.access_token, data.user);
  return data.access_token;
}

/** Restore the admin session on page load (the access token lives only in memory). */
export async function restoreSession(): Promise<void> {
  if (useAuthStore.getState().status !== "unknown") return;
  await refreshAccessToken("admin");
  if (useAuthStore.getState().status === "unknown") {
    // Unreachable server: treat as signed out; the login page will surface the network error.
    useAuthStore.getState().clearSession();
  }
}
