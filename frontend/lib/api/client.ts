import { ApiError, NetworkError } from "./errors";

export const API_PREFIX = "/api/v1";

/** Sent on every request; the backend requires it on cookie-authenticated endpoints (CSRF). */
export const CLIENT_HEADER = { "X-Requested-With": "pos" } as const;

type Query = Record<string, string | number | boolean | null | undefined>;

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** Attach the bearer token (default true). */
  auth?: boolean;
  /** Override the token (e.g. a device token). */
  token?: string;
}

export interface ApiClientConfig {
  baseUrl?: string;
  fetchFn?: typeof fetch;
  getAccessToken: () => string | null;
  /** Obtain a new access token (e.g. via the refresh cookie). Returns null if not possible. */
  refreshAccessToken: () => Promise<string | null>;
  /** Called when a request is still unauthorized after a refresh attempt. */
  onUnauthenticated: () => void;
}

export interface ApiClient {
  request: <T>(path: string, options?: RequestOptions) => Promise<T>;
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => Promise<T>;
  post: <T>(path: string, body?: unknown) => Promise<T>;
  put: <T>(path: string, body?: unknown) => Promise<T>;
  patch: <T>(path: string, body?: unknown) => Promise<T>;
  delete: <T>(path: string) => Promise<T>;
}

export function buildUrl(baseUrl: string, path: string, query?: Query): string {
  const url = `${baseUrl}${API_PREFIX}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = config.baseUrl ?? "";
  const fetchFn = config.fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  // Single-flight refresh: concurrent 401s share one refresh request, so a rotated refresh
  // token is never presented twice (which the server would treat as token theft).
  let inflightRefresh: Promise<string | null> | null = null;
  const refreshOnce = (): Promise<string | null> => {
    inflightRefresh ??= config.refreshAccessToken().finally(() => {
      inflightRefresh = null;
    });
    return inflightRefresh;
  };

  async function send(path: string, options: RequestOptions, token: string | null): Promise<Response> {
    const headers: Record<string, string> = { Accept: "application/json", ...CLIENT_HEADER };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      return await fetchFn(buildUrl(baseUrl, path, options.query), {
        method: options.method ?? "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        credentials: "same-origin",
        signal: options.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      throw new NetworkError(undefined, { cause: error });
    }
  }

  async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const useAuth = options.auth !== false && options.token === undefined;
    const token = options.token ?? (useAuth ? config.getAccessToken() : null);
    let response = await send(path, options, token);

    if (response.status === 401 && useAuth) {
      const refreshed = await refreshOnce();
      if (refreshed) {
        response = await send(path, options, refreshed);
      }
      if (response.status === 401) {
        config.onUnauthenticated();
      }
    }

    if (!response.ok) throw await ApiError.fromResponse(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  return {
    request,
    get: (path, query, signal) => request(path, { query, signal }),
    post: (path, body) => request(path, { method: "POST", body }),
    put: (path, body) => request(path, { method: "PUT", body }),
    patch: (path, body) => request(path, { method: "PATCH", body }),
    delete: (path) => request(path, { method: "DELETE" }),
  };
}
