"use client";

import { API_PREFIX, CLIENT_HEADER } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { refreshAccessToken } from "@/lib/auth/session";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Download a file from an authenticated endpoint (CSV exports).
 *
 * A plain `<a href>` can't be used: the access token lives in memory and is sent as a header.
 */
export async function downloadAuthed(path: string, fallbackName: string): Promise<void> {
  const send = (token: string | null) =>
    fetch(`${API_PREFIX}${path}`, {
      headers: { ...CLIENT_HEADER, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      credentials: "same-origin",
    });
  let response = await send(useAuthStore.getState().accessToken);
  if (response.status === 401) {
    const token = await refreshAccessToken("admin");
    if (token) response = await send(token);
  }
  if (!response.ok) throw await ApiError.fromResponse(response);
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const name = /filename="?([^";]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
