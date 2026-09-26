import type { DeviceClient } from "@/lib/device/device-client";
import type { PullResponse, PushRequest, PushResponse, SyncContext } from "@/types/sync";

import type { SyncTransport } from "./engine";

/** Sync over HTTP with the device token. */
export function deviceTransport(client: DeviceClient): SyncTransport {
  return {
    push: (request: PushRequest) => client.request<PushResponse>("/sync/push", { method: "POST", body: request }),
    pull: (cursor: string | null, limit: number) =>
      client.request<PullResponse>("/sync/pull", { query: { cursor: cursor ?? undefined, limit } }),
  };
}

export function fetchSyncContext(client: DeviceClient): Promise<SyncContext> {
  return client.request<SyncContext>("/sync/context");
}
