import { getMeta } from "@/lib/db/meta";
import { getDb } from "@/lib/db/schema";

import { DeviceClient } from "./device-client";

let client: DeviceClient | null = null;

/** The terminal's device-authenticated API client (credentials read from IndexedDB). */
export function getDeviceClient(): DeviceClient {
  client ??= new DeviceClient({
    getCredentials: async () => {
      const db = getDb();
      const [device, keys] = await Promise.all([getMeta(db, "device"), getMeta(db, "deviceKeys")]);
      return device && keys ? { deviceId: device.deviceId, keys } : null;
    },
  });
  return client;
}
