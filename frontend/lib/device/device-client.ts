/**
 * API access as the *device* (sync, context). Device tokens come from the challenge–response
 * flow (docs/DEVICE_MANAGEMENT.md §3) and are kept in memory only.
 */
import { API_PREFIX, CLIENT_HEADER } from "@/lib/api/client";
import { ApiError, NetworkError } from "@/lib/api/errors";

import { signChallenge } from "./keys";

export interface DeviceCredentials {
  deviceId: string;
  keys: CryptoKeyPair;
}

export interface DeviceClientOptions {
  getCredentials: () => Promise<DeviceCredentials | null>;
  fetchFn?: typeof fetch;
  now?: () => number;
  /** Refresh this many ms before expiry. */
  skewMs?: number;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class DeviceNotRegisteredError extends Error {
  constructor() {
    super("This terminal is not registered");
    this.name = "DeviceNotRegisteredError";
  }
}

export class DeviceClient {
  private cached: CachedToken | null = null;
  private inflight: Promise<string> | null = null;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly skewMs: number;

  constructor(private readonly options: DeviceClientOptions) {
    this.fetchFn = options.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    this.now = options.now ?? Date.now;
    this.skewMs = options.skewMs ?? 60_000;
  }

  /** Forget the cached token (e.g. after the server rejected it). */
  invalidate(): void {
    this.cached = null;
  }

  async token(): Promise<string> {
    if (this.cached && this.cached.expiresAt - this.skewMs > this.now()) return this.cached.token;
    // Single-flight: parallel callers share one challenge–response round trip.
    this.inflight ??= this.authenticate().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async authenticate(): Promise<string> {
    const credentials = await this.options.getCredentials();
    if (!credentials) throw new DeviceNotRegisteredError();
    const { deviceId, keys } = credentials;
    const challenge = await this.raw<{ nonce: string }>(`/devices/${deviceId}/challenge`, { method: "POST" });
    const signature = await signChallenge(keys, deviceId, challenge.nonce);
    const issued = await this.raw<{ access_token: string; expires_in: number }>("/devices/token", {
      method: "POST",
      body: { device_id: deviceId, nonce: challenge.nonce, signature },
    });
    this.cached = { token: issued.access_token, expiresAt: this.now() + issued.expires_in * 1000 };
    return issued.access_token;
  }

  /** Authenticated request; re-authenticates once on 401. */
  async request<T>(path: string, init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> } = {}): Promise<T> {
    let token = await this.token();
    try {
      return await this.raw<T>(path, init, token);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      this.invalidate();
      token = await this.token();
      return this.raw<T>(path, init, token);
    }
  }

  private async raw<T>(
    path: string,
    init: { method?: string; body?: unknown; query?: Record<string, string | number | undefined> },
    token?: string,
  ): Promise<T> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(init.query ?? {})) if (v !== undefined) params.set(k, String(v));
    const qs = params.toString();
    const headers: Record<string, string> = { Accept: "application/json", ...CLIENT_HEADER };
    if (init.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    let response: Response;
    try {
      response = await this.fetchFn(`${API_PREFIX}${path}${qs ? `?${qs}` : ""}`, {
        method: init.method ?? "GET",
        headers,
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        cache: "no-store",
      });
    } catch (error) {
      throw new NetworkError(undefined, { cause: error });
    }
    if (!response.ok) throw await ApiError.fromResponse(response);
    return (await response.json()) as T;
  }
}
